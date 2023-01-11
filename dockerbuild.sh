#!/bin/bash
docker system prune
docker build -t crunchwrap89/mapcanvas3d_socketserver .
docker push crunchwrap89/mapcanvas3d_socketserver
$SHELL