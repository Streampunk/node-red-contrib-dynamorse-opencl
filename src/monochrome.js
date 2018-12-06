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

const monochromeKernel = `
  __kernel void monochrome(__global float4* restrict input,
                           __global float4* restrict output,
                           __private unsigned int width,
                           __constant float4* restrict monoCoeffs,
                           __private float pressure) {
    uint item = get_global_id(0);
    bool lastItemOnLine = get_local_id(0) == get_local_size(0) - 1;

    // 16 pixels per workItem
    uint numPixels = lastItemOnLine && (0 != width % 16) ? width % 16 : 16;
    uint numLoops = numPixels;

    uint off = width * get_group_id(0) + get_local_id(0) * 16;

    float p0 = pressure;
    float p1 = 1.0f - p0;
    float4 coeffs = *monoCoeffs * p0;

    for (uint i=0; i<numLoops; ++i) {
      float4 rgbaIn = input[off];

      float mono = dot(rgbaIn, coeffs);
      float4 rgbaOut = (float4)(mono+rgbaIn.s0*p1, mono+rgbaIn.s1*p1, mono+rgbaIn.s2*p1, rgbaIn.s3);
      output[off] = rgbaOut;

      off++;
    }
  }
`;

function monochrome(node, context, width, height, colSpec) {
  this.node = node;
  this.context = context;
  this.width = width;

  // process one image line per work group, 16 pixels per work item
  this.workItemsPerGroup = ((width + 15) / 16) >>> 0;
  this.globalWorkItems = this.workItemsPerGroup * height;

  const coeffs = colMaths.rgb2monoCoeffs(colSpec);
  this.monoCoeffsArray = colMaths.matrixFlatten(coeffs);

  return this;
}

monochrome.prototype.init = async function() {
  this.monoCoeffs = await this.context.createBuffer(this.monoCoeffsArray.byteLength, 'readonly', 'none', this.node.ownerName);
  await this.monoCoeffs.hostAccess('writeonly', Buffer.from(this.monoCoeffsArray.buffer));

  this.monochromeProgram = await this.context.createProgram(monochromeKernel, {
    name: 'monochrome',
    globalWorkItems: this.globalWorkItems,
    workItemsPerGroup: this.workItemsPerGroup
  });
};

monochrome.prototype.process = async function(src, dst, pressure) {
  return await this.context.runProgram(
    this.monochromeProgram,
    { input: src, output: dst, width: this.width,
      monoCoeffs: this.monoCoeffs, pressure: pressure }
  );
};

module.exports = monochrome;
