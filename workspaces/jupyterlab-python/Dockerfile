FROM prairielearn/workspace-jupyterlab-base:latest
ARG CACHEBUST=2026-04-15-14-40-23

USER root
COPY install.sh requirements.txt /
RUN /bin/bash /install.sh

USER jovyan
