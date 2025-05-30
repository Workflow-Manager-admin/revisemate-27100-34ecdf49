#!/bin/bash
cd /home/kavia/workspace/code-generation/revisemate-27100-34ecdf49/revise_mate
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

