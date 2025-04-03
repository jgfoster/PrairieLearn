import fg from 'fast-glob';
import { z } from 'zod';

import * as error from '@prairielearn/error';
import * as sqldb from '@prairielearn/postgres';
import { workspaceFastGlobDefaultOptions } from '@prairielearn/workspace-utils';

import { selectCourseInstanceById } from '../models/course-instances.js';
import { selectCourseById } from '../models/course.js';
import { selectQuestionById, selectQuestionByInstanceQuestionId } from '../models/question.js';
import * as questionServers from '../question-servers/index.js';

import { type Course, IdSchema, type Question, type Variant, VariantSchema } from './db-types.js';
import { idsEqual } from './id.js';
import { writeCourseIssues } from './issues.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const VariantWithFormattedDateSchema = VariantSchema.extend({
  formatted_date: z.string(),
});
type VariantWithFormattedDate = z.infer<typeof VariantWithFormattedDateSchema>;

const InstanceQuestionDataSchema = z.object({
  question_id: IdSchema,
  user_id: IdSchema.nullable(),
  group_id: IdSchema.nullable(),
  assessment_instance_id: IdSchema,
  course_instance_id: IdSchema,
  instance_question_open: z.boolean().nullable(),
  assessment_instance_open: z.boolean().nullable(),
});

interface VariantCreationData {
  variant_seed: string;
  params: Record<string, any>;
  true_answer: Record<string, any>;
  options: Record<string, any>;
  broken: boolean;
}

/**
 * Internal function, do not call directly. Create a variant object, do not write to DB.
 * @protected
 *
 * @param question - The question for the variant.
 * @param course - The course for the question.
 * @param options - Options controlling the creation: options = {variant_seed}
 */
async function makeVariant(
  question: Question,
  course: Course,
  options: { variant_seed?: string | null },
): Promise<{
  courseIssues: (Error & { fatal?: boolean; data?: any })[];
  variant: VariantCreationData;
}> {
  let variant_seed: string;
  if (options.variant_seed != null) {
    variant_seed = options.variant_seed;
  } else {
    variant_seed = Math.floor(Math.random() * Math.pow(2, 32)).toString(36);
  }

  const questionModule = questionServers.getModule(question.type);
  const { courseIssues, data } = await questionModule.generate(question, course, variant_seed);
  const hasFatalIssue = courseIssues.some((issue) => issue.fatal);
  let variant: VariantCreationData = {
    variant_seed,
    params: data.params || {},
    true_answer: data.true_answer || {},
    options: data.options || {},
    broken: hasFatalIssue,
  };

  if (question.workspace_image !== null) {
    // if workspace, add graded files to params
    variant.params['_workspace_required_file_names'] = (
      question.workspace_graded_files || []
    ).filter((file) => !fg.isDynamicPattern(file, workspaceFastGlobDefaultOptions));
    if (!('_required_file_names' in variant.params)) {
      variant.params['_required_file_names'] = [];
    }
    variant.params['_required_file_names'] = variant.params['_required_file_names'].concat(
      variant.params['_workspace_required_file_names'],
    );
  }

  if (!variant.broken) {
    const { courseIssues: prepareCourseIssues, data } = await questionModule.prepare(
      question,
      course,
      variant,
    );
    courseIssues.push(...prepareCourseIssues);
    const hasFatalIssue = courseIssues.some((issue) => issue.fatal);
    variant = {
      variant_seed,
      params: data.params || {},
      true_answer: data.true_answer || {},
      options: data.options || {},
      broken: hasFatalIssue,
    };
  }

  return { courseIssues, variant };
}

/**
 * Get a file that is generated by code.
 *
 * @param filename
 * @param variant - The variant.
 * @param question - The question for the variant.
 * @param variant_course - The course for the variant.
 * @param user_id - The current effective user.
 * @param authn_user_id - The current authenticated user.
 */
export async function getDynamicFile(
  filename: string,
  variant: Variant,
  question: Question,
  variant_course: Course,
  user_id: string,
  authn_user_id: string,
): Promise<Buffer> {
  const question_course = await getQuestionCourse(question, variant_course);
  const questionModule = questionServers.getModule(question.type);
  if (!questionModule.file) {
    throw new Error(`Question type ${question.type} does not support file generation`);
  }
  const { courseIssues, data: fileData } = await questionModule.file(
    filename,
    variant,
    question,
    question_course,
  );

  const studentMessage = 'Error creating file: ' + filename;
  const courseData = { variant, question, course: variant_course };
  await writeCourseIssues(
    courseIssues,
    variant,
    user_id,
    authn_user_id,
    studentMessage,
    courseData,
  );
  return fileData;
}

/**
 * Internal function, do not call directly. Get a question by either question_id or instance_question_id.
 * @protected
 *
 * @param question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param instance_question_id - The instance question for the new variant. Can be null if question_id is provided.
 */
async function selectQuestion(
  question_id: string | null,
  instance_question_id: string | null,
): Promise<Question> {
  if (question_id != null) {
    return await selectQuestionById(question_id);
  } else if (instance_question_id != null) {
    return await selectQuestionByInstanceQuestionId(instance_question_id);
  } else {
    throw new Error('question_id and instance_question_id cannot both be null');
  }
}

async function lockAssessmentInstanceForInstanceQuestion(
  instance_question_id: string,
): Promise<void> {
  const assessment_instance_id = await sqldb.queryOptionalRow(
    sql.select_and_lock_assessment_instance_for_instance_question,
    { instance_question_id },
    IdSchema,
  );
  if (assessment_instance_id == null) {
    throw new error.HttpStatusError(404, 'Instance question not found');
  }
}

async function selectVariantForInstanceQuestion(
  instance_question_id: string,
  require_open: boolean,
): Promise<VariantWithFormattedDate | null> {
  return await sqldb.queryOptionalRow(
    sql.select_variant_for_instance_question,
    { instance_question_id, require_open },
    VariantWithFormattedDateSchema,
  );
}

/**
 * Internal function, do not call directly. Create a variant object, and write it to the DB.
 * @protected
 *
 * @param question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param instance_question_id - The instance question for the new variant, or null for a floating variant.
 * @param user_id - The user for the new variant.
 * @param authn_user_id - The current authenticated user.
 * @param course_instance_id - The course instance for this variant. Can be null for instructor questions.
 * @param variant_course - The course for the variant.
 * @param question_course - The course for the question.
 * @param options - Options controlling the creation: options = {variant_seed}
 * @param require_open - If true, only use an existing variant if it is open.
 * @param client_fingerprint_id - The client fingerprint for this variant.
 */
async function makeAndInsertVariant(
  question_id: string | null,
  instance_question_id: string | null,
  user_id: string,
  authn_user_id: string,
  course_instance_id: string | null,
  variant_course: Course,
  question_course: Course,
  options: { variant_seed?: string | null },
  require_open: boolean,
  client_fingerprint_id: string | null,
): Promise<VariantWithFormattedDate> {
  const question = await selectQuestion(question_id, instance_question_id);
  const { courseIssues, variant: variantData } = await makeVariant(
    question,
    question_course,
    options,
  );

  const variant = await sqldb.runInTransactionAsync(async () => {
    let real_user_id: string | null = user_id;
    let real_group_id: string | null = null;
    let new_number: number | null = 1;

    if (instance_question_id != null) {
      await lockAssessmentInstanceForInstanceQuestion(instance_question_id);
      const instance_question = await sqldb.queryOptionalRow(
        sql.select_instance_question_data,
        { instance_question_id },
        InstanceQuestionDataSchema,
      );
      if (instance_question == null) {
        throw new error.HttpStatusError(404, 'Instance question not found');
      }

      // This handles the race condition where we simultaneously start
      // generating two variants for the same instance question. If we're the
      // second one to try and insert a variant, just pull the existing variant
      // back out of the database and use that instead.
      const existing_variant = await selectVariantForInstanceQuestion(
        instance_question_id,
        require_open,
      );
      if (existing_variant != null) {
        return existing_variant;
      }

      if (!instance_question.instance_question_open) {
        throw new error.HttpStatusError(403, 'Instance question is not open');
      }
      if (!instance_question.assessment_instance_open) {
        throw new error.HttpStatusError(403, 'Assessment instance is not open');
      }

      question_id = instance_question.question_id;
      course_instance_id = instance_question.course_instance_id;
      real_user_id = instance_question.user_id;
      real_group_id = instance_question.group_id;

      new_number = await sqldb.queryOptionalRow(
        sql.next_variant_number,
        { instance_question_id },
        z.number().nullable(),
      );
    } else {
      if (question_id == null) {
        throw new Error(
          'Attempt to create a variant without a question ID or instance question ID',
        );
      }
      if (user_id == null) {
        throw new Error('Attempt to create a variant without a user ID');
      }

      if (course_instance_id != null) {
        const course_instance = await selectCourseInstanceById(course_instance_id);
        if (!course_instance || !idsEqual(course_instance.course_id, variant_course.id)) {
          throw new error.HttpStatusError(403, 'Course instance not found in course');
        }
      }
    }

    const question = await selectQuestionById(question_id);
    let workspace_id: string | null = null;
    if (question.workspace_image !== null) {
      workspace_id = await sqldb.queryOptionalRow(sql.insert_workspace, IdSchema);
    }

    return await sqldb.queryRow(
      sql.insert_variant,
      {
        ...variantData,
        instance_question_id,
        question_id,
        course_instance_id,
        user_id: real_user_id,
        group_id: real_group_id,
        number: new_number ?? 1,
        authn_user_id,
        workspace_id,
        course_id: variant_course.id,
        client_fingerprint_id,
      },
      VariantWithFormattedDateSchema,
    );
  });

  const studentMessage = 'Error creating question variant';
  const courseData = { variant, question, course: variant_course };
  await writeCourseIssues(
    courseIssues,
    variant,
    user_id,
    authn_user_id,
    studentMessage,
    courseData,
  );
  return variant;
}

/**
 * Ensure that there is a variant for the given instance question.
 *
 * @param question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param instance_question_id - The instance question for the new variant, or null for a floating variant.
 * @param user_id - The user for the new variant.
 * @param authn_user_id - The current authenticated user.
 * @param course_instance_id - The course instance for this variant. Can be null for instructor questions.
 * @param variant_course - The course for the variant.
 * @param question_course - The course for the question.
 * @param options - Options controlling the creation: options = {variant_seed}
 * @param require_open - If true, only use an existing variant if it is open.
 * @param client_fingerprint_id - The client fingerprint for this variant. Can be null.
 */
export async function ensureVariant(
  question_id: string | null,
  instance_question_id: string | null,
  user_id: string,
  authn_user_id: string,
  course_instance_id: string | null,
  variant_course: Course,
  question_course: Course,
  options: { variant_seed?: string | null },
  require_open: boolean,
  client_fingerprint_id: string | null,
): Promise<VariantWithFormattedDate> {
  if (instance_question_id != null) {
    // See if we have a useable existing variant, otherwise make a new one. This
    // test is also performed in makeAndInsertVariant inside a transaction to
    // avoid race conditions, but we do it here too to avoid the
    // generate/prepare overhead in the most common cases.
    const variant = await selectVariantForInstanceQuestion(instance_question_id, require_open);
    if (variant != null) {
      return variant;
    }
  }
  // if we don't have instance_question_id or if it's not open, just make a new variant
  return await makeAndInsertVariant(
    question_id,
    instance_question_id,
    user_id,
    authn_user_id,
    course_instance_id,
    variant_course,
    question_course,
    options,
    require_open,
    client_fingerprint_id,
  );
}

/**
 * Get the course associated with the question
 *
 * @param question - The question for the variant.
 * @param variant_course - The course for the variant.
 */
export async function getQuestionCourse(
  question: Question,
  variant_course: Course,
): Promise<Course> {
  if (question.course_id === variant_course.id) {
    return variant_course;
  } else {
    return selectCourseById(question.course_id);
  }
}
