FROM prairielearn/workspace-jupyterlab-base:latest
ARG CACHEBUST=2025-09-15-14-07-45

USER root
COPY install.sh requirements.txt /
RUN /bin/bash /install.sh

USER jovyan
