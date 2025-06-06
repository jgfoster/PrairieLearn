import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'path';

import esbuild, { type Metafile } from 'esbuild';
import expressStaticGzip from 'express-static-gzip';
import fs from 'fs-extra';
import { globby } from 'globby';

import { type HtmlSafeString, html } from '@prairielearn/html';

const DEFAULT_OPTIONS = {
  dev: process.env.NODE_ENV !== 'production',
  sourceDirectory: './assets',
  buildDirectory: './public/build',
  publicPath: '/build/',
};

type AssetsManifest = Record<string, string>;

export interface CompiledAssetsOptions {
  /**
   * Whether the app is running in dev mode. If dev mode is enabled, then
   * assets will be built on the fly as they're requested. Otherwise, assets
   * should have been pre-compiled to the `buildDirectory` directory.
   */
  dev?: boolean;
  /** Root directory of assets. */
  sourceDirectory?: string;
  /** Directory where the built assets will be output to. */
  buildDirectory?: string;
  /** The path that assets will be served from, e.g. `/build/`. */
  publicPath?: string;
}

let options: Required<CompiledAssetsOptions> = { ...DEFAULT_OPTIONS };
let esbuildContext: esbuild.BuildContext | null = null;
let esbuildServer: esbuild.ServeResult | null = null;
let relativeSourcePaths: string[] | null = null;

export async function init(newOptions: Partial<CompiledAssetsOptions>): Promise<void> {
  options = {
    ...DEFAULT_OPTIONS,
    ...newOptions,
  };

  if (!options.publicPath.endsWith('/')) {
    options.publicPath += '/';
  }

  if (options.dev) {
    // Use esbuild's asset server in development.
    //
    // Note that esbuild doesn't support globs, so the server will not pick up
    // new entrypoints that are added while the server is running.
    const sourceGlob = path.join(options.sourceDirectory, '*', '*.{js,ts,jsx,tsx,css}');
    const sourcePaths = await globby(sourceGlob);

    // Save the result of globbing for the source paths so that we can later
    // check if a given filename exists.
    relativeSourcePaths = sourcePaths.map((p) => path.relative(options.sourceDirectory, p));

    esbuildContext = await esbuild.context({
      entryPoints: sourcePaths,
      target: 'es2017',
      format: 'iife',
      sourcemap: 'inline',
      bundle: true,
      write: false,
      loader: {
        '.woff': 'file',
        '.woff2': 'file',
      },
      outbase: options.sourceDirectory,
      outdir: options.buildDirectory,
      entryNames: '[dir]/[name]',
    });

    esbuildServer = await esbuildContext.serve({ host: '0.0.0.0' });
  }
}

/**
 * Shuts down the development assets compiler if it is running.
 */
export async function close() {
  esbuildContext?.dispose();
}

export function assertConfigured(): void {
  if (!options) {
    throw new Error('@prairielearn/compiled-assets was not configured');
  }
}

export function handler() {
  assertConfigured();

  if (!options?.dev) {
    // We're running in production: serve all assets from the build directory.
    // Set headers to cache for as long as possible, since the assets will
    // include content hashes in their filenames.
    return expressStaticGzip(options?.buildDirectory, {
      enableBrotli: true,
      // Prefer Brotli if the client supports it.
      orderPreference: ['br'],
      serveStatic: {
        maxAge: '31557600',
        immutable: true,
      },
    });
  }

  if (!esbuildServer) {
    throw new Error('esbuild server not initialized');
  }

  const { port } = esbuildServer;

  // We're running in dev mode, so we need to boot up esbuild to start building
  // and watching our assets.
  return function (req: IncomingMessage, res: ServerResponse) {
    // esbuild will reject requests that come from hosts other than the host on
    // which the esbuild dev server is listening:
    // https://github.com/evanw/esbuild/commit/de85afd65edec9ebc44a11e245fd9e9a2e99760d
    // https://github.com/evanw/esbuild/releases/tag/v0.25.0
    // We work around this by modifying the request headers to make it look like
    // the request is coming from localhost, which esbuild won't reject.
    const headers = structuredClone(req.headers);
    headers.host = 'localhost';
    delete headers['x-forwarded-for'];
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-proto'];
    delete headers['referer'];

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      },
    );
    req.pipe(proxyReq, { end: true });
  };
}

let cachedManifest: AssetsManifest | null = null;
function readManifest(): AssetsManifest {
  assertConfigured();

  if (!cachedManifest) {
    const manifestPath = path.join(options.buildDirectory, 'manifest.json');
    cachedManifest = fs.readJSONSync(manifestPath) as AssetsManifest;
  }

  return cachedManifest;
}

function compiledPath(type: 'scripts' | 'stylesheets', sourceFile: string): string {
  assertConfigured();
  const sourceFilePath = `${type}/${sourceFile}`;

  if (options.dev) {
    // To ensure that errors that would be raised in production are also raised
    // in development, we'll check for the existence of the asset file on disk.
    // This mirrors the production check of the file in the manifest: if a file
    // exists on disk, it should be in the manifest.
    if (!relativeSourcePaths?.find((p) => p === sourceFilePath)) {
      throw new Error(`Unknown ${type} asset: ${sourceFile}`);
    }

    return options.publicPath + sourceFilePath.replace(/\.(js|ts)x?$/, '.js');
  }

  const manifest = readManifest();
  const assetPath = manifest[sourceFilePath];
  if (!assetPath) {
    throw new Error(`Unknown ${type} asset: ${sourceFile}`);
  }

  return options.publicPath + assetPath;
}

export function compiledScriptPath(sourceFile: string): string {
  return compiledPath('scripts', sourceFile);
}

export function compiledStylesheetPath(sourceFile: string): string {
  return compiledPath('stylesheets', sourceFile);
}

export function compiledScriptTag(sourceFile: string): HtmlSafeString {
  return html`<script src="${compiledScriptPath(sourceFile)}"></script>`;
}

export function compiledStylesheetTag(sourceFile: string): HtmlSafeString {
  return html`<link rel="stylesheet" href="${compiledStylesheetPath(sourceFile)}" />`;
}

async function buildAssets(sourceDirectory: string, buildDirectory: string) {
  await fs.ensureDir(buildDirectory);

  const files = await globby(path.join(sourceDirectory, '*/*.{js,jsx,ts,tsx,css}'));
  const buildResult = await esbuild.build({
    entryPoints: files,
    target: 'es2017',
    format: 'iife',
    sourcemap: 'linked',
    bundle: true,
    minify: true,
    loader: {
      '.woff': 'file',
      '.woff2': 'file',
    },
    entryNames: '[dir]/[name]-[hash]',
    outbase: sourceDirectory,
    outdir: buildDirectory,
    metafile: true,
  });

  return buildResult.metafile;
}

function makeManifest(
  metafile: Metafile,
  sourceDirectory: string,
  buildDirectory: string,
): Record<string, string> {
  const manifest: Record<string, string> = {};
  Object.entries(metafile.outputs).forEach(([outputPath, meta]) => {
    if (!meta.entryPoint) return;

    const entryPath = path.relative(sourceDirectory, meta.entryPoint);
    const assetPath = path.relative(buildDirectory, outputPath);
    manifest[entryPath] = assetPath;
  });
  return manifest;
}

export async function build(
  sourceDirectory: string,
  buildDirectory: string,
): Promise<AssetsManifest> {
  // Remove existing assets to ensure that no stale assets are left behind.
  await fs.remove(buildDirectory);

  const metafile = await buildAssets(sourceDirectory, buildDirectory);
  const manifest = makeManifest(metafile, sourceDirectory, buildDirectory);
  const manifestPath = path.join(buildDirectory, 'manifest.json');
  await fs.writeJSON(manifestPath, manifest);

  return manifest;
}
