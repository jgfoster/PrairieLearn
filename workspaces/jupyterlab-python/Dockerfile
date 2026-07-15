FROM prairielearn/workspace-jupyterlab-base:latest
ARG CACHEBUST=2026-07-15-14-38-19

USER root
COPY install.sh requirements.txt /
RUN /bin/bash /install.sh

USER jovyan
