#!/bin/bash

rm -rf lib/eigenda || true
git clone https://github.com/Layr-Labs/eigenda lib/eigenda
(cd ./lib/eigenda/api/proto && protoc -I=. ./disperser/disperser.proto --js_out=import_style=commonjs:. --grpc-web_out=import_style=typescript,mode=grpcwebtext:.)
(cd ./lib/eigenda/api/proto && protoc -I=. ./common/common.proto --js_out=import_style=commonjs:. --grpc-web_out=import_style=typescript,mode=grpcwebtext:.)

rm -rf ./src/gen/* || true
cp ./lib/eigenda/api/proto/disperser/*.js ./src/gen/
cp ./lib/eigenda/api/proto/disperser/*.ts ./src/gen/

cp ./lib/eigenda/api/proto/common/*.js ./src/gen/
cp ./lib/eigenda/api/proto/common/*.ts ./src/gen/
