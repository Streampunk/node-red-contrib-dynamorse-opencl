/* Copyright 2018 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

const colMaths = require('./colourMaths.js');

const rgba8Kernel = `
  __kernel void read(__global uchar4* restrict input,
                     __global float4* restrict output,
                     __private unsigned int width,
                     __global float* restrict gammaLut,
                     __constant float3* restrict gamutMatrix) {
    uint item = get_global_id(0);
    bool lastItemOnLine = get_local_id(0) == get_local_size(0) - 1;

    // 32 pixels per workItem
    uint numPixels = lastItemOnLine && (0 != width % 32) ? width % 32 : 32;
    uint numLoops = numPixels;

    uint off = width * get_group_id(0) + get_local_id(0) * 32;

    float3 gamutMatR = gamutMatrix[0];
    float3 gamutMatG = gamutMatrix[1];
    float3 gamutMatB = gamutMatrix[2];

    for (uint i=0; i<numLoops; ++i) {
      uchar4 rgbaIn = input[off];
      ushort4 rgbaIn_s = convert_ushort4_sat_rte(convert_uint4(rgbaIn) * 65535 / 255);
      float3 rgb_i = (float3)(gammaLut[rgbaIn_s.s0], gammaLut[rgbaIn_s.s1], gammaLut[rgbaIn_s.s2]);

      float4 rgba;
      rgba.s0 = dot(rgb_i, gamutMatR);
      rgba.s1 = dot(rgb_i, gamutMatG);
      rgba.s2 = dot(rgb_i, gamutMatB);
      rgba.s3 = gammaLut[rgbaIn_s.s3];

      output[off] = rgba;

      off++;
    }
  }

  __kernel void write(__global float4* restrict input,
                      __global uchar4* restrict output,
                      __private unsigned int width,
                      __global float* restrict gammaLut) {
    uint item = get_global_id(0);
    bool lastItemOnLine = get_local_id(0) == get_local_size(0) - 1;

    // 32 pixels per workItem
    uint numPixels = lastItemOnLine && (0 != width % 32) ? width % 32 : 32;
    uint numLoops = numPixels;

    uint off = width * get_group_id(0) + get_local_id(0) * 32;

    for (uint i=0; i<numLoops; ++i) {
      float4 rgbaIn = input[off];
      float4 rgba_g;
      rgba_g.s0 = gammaLut[convert_ushort_sat_rte(rgbaIn.s0 * 65535.0f)];
      rgba_g.s1 = gammaLut[convert_ushort_sat_rte(rgbaIn.s1 * 65535.0f)];
      rgba_g.s2 = gammaLut[convert_ushort_sat_rte(rgbaIn.s2 * 65535.0f)];
      rgba_g.s3 = gammaLut[convert_ushort_sat_rte(rgbaIn.s3 * 65535.0f)];

      uchar4 rgba;
      rgba.s0 = convert_uchar_sat_rte(rgba_g.s0 * 255.0);
      rgba.s1 = convert_uchar_sat_rte(rgba_g.s1 * 255.0);
      rgba.s2 = convert_uchar_sat_rte(rgba_g.s2 * 255.0);
      rgba.s3 = convert_uchar_sat_rte(rgba_g.s3 * 255.0);

      output[off] = rgba;

      off++;
    }
  }
`;

function getPitchBytes(width) {
  return width * 4;
}

function setDestTags(dstTags) {
  dstTags.bits = 8;
  dstTags.packing = 'RGBA8';
  dstTags.sampling = 'RGBA-4:4:4:4';
  dstTags.hasAlpha = false;
  return dstTags;
}

function reader(context, width, height, colSpec, outColSpec) {
  this.context = context;
  this.width = width;

  // process one image line per work group, 32 pixels per work item
  this.workItemsPerGroup = ((width + 31) / 32) >>> 0;
  this.globalWorkItems = this.workItemsPerGroup * height;

  this.gammaArray = colMaths.gamma2linearLUT(colSpec);

  const gamutMatrix2d = colMaths.rgb2rgbMatrix(colSpec, outColSpec);
  this.gamutMatrixArray = colMaths.matrixFlatten(gamutMatrix2d);

  return this;
}

reader.prototype.init = async function() {
  this.gammaLut = await this.context.createBuffer(this.gammaArray.byteLength, 'readonly', 'coarse');
  await this.gammaLut.hostAccess('writeonly', Buffer.from(this.gammaArray.buffer));

  this.gamutMatrix = await this.context.createBuffer(this.gamutMatrixArray.byteLength, 'readonly', 'none');
  await this.gamutMatrix.hostAccess('writeonly', Buffer.from(this.gamutMatrixArray.buffer));

  this.rgba8ReadProgram = await this.context.createProgram(rgba8Kernel, {
    name: 'read',
    globalWorkItems: this.globalWorkItems,
    workItemsPerGroup: this.workItemsPerGroup
  });
};

reader.prototype.fromPacked = async function(src, dst) {
  return await this.rgba8ReadProgram.run({input: src, output: dst, width: this.width, 
    gammaLut: this.gammaLut, gamutMatrix: this.gamutMatrix});
};

function writer(context, width, height, colSpec) {
  this.context = context;
  this.width = width;

  // process one image line per work group, 32 pixels per work item
  this.workItemsPerGroup = ((width + 31) / 32) >>> 0;
  this.globalWorkItems = this.workItemsPerGroup * height;

  this.gammaArray = colMaths.linear2gammaLUT(colSpec);
  return this;
}

writer.prototype.init = async function() {
  this.gammaLut = await this.context.createBuffer(this.gammaArray.byteLength, 'readonly', 'coarse');
  await this.gammaLut.hostAccess('writeonly', Buffer.from(this.gammaArray.buffer));

  this.rgba8WriteProgram = await this.context.createProgram(rgba8Kernel, {
    name: 'write',
    globalWorkItems: this.globalWorkItems,
    workItemsPerGroup: this.workItemsPerGroup
  });
};

writer.prototype.toPacked = async function(src, dst) {
  return await this.rgba8WriteProgram.run({input: src, output: dst, width: this.width, 
    gammaLut: this.gammaLut});
};

module.exports = {
  reader: reader,
  writer: writer,

  getPitchBytes: getPitchBytes,
  setDestTags: setDestTags
};