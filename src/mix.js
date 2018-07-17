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

const mixKernel = `
  __kernel void mixProc(__global float4* restrict inputA,
                        __global float4* restrict inputB,
                        __global float4* restrict output,
                        __private unsigned int width,
                        __private float pressure) {
    uint item = get_global_id(0);
    bool lastItemOnLine = get_local_id(0) == get_local_size(0) - 1;

    // 16 pixels per workItem
    uint numPixels = lastItemOnLine && (0 != width % 16) ? width % 16 : 16;
    uint numLoops = numPixels;

    uint off = width * get_group_id(0) + get_local_id(0) * 16;

    float p0 = pressure;
    float p1 = 1.0f - p0;

    for (uint i=0; i<numLoops; ++i) {
      float4 rgbaInA = inputA[off] * p0;
      float4 rgbaInB = inputB[off] * p1;

      float4 rgbaOut = rgbaInA + rgbaInB;
      output[off] = rgbaOut;

      off++;
    }
  }
`;

function mix(context, width, height) {
  this.context = context;
  this.width = width;

  // process one image line per work group, 16 pixels per work item
  this.workItemsPerGroup = ((width + 15) / 16) >>> 0;
  this.globalWorkItems = this.workItemsPerGroup * height;

  return this;
}

mix.prototype.init = async function() {
  this.mixProgram = await this.context.createProgram(mixKernel, {
    name: 'mixProc',
    globalWorkItems: this.globalWorkItems,
    workItemsPerGroup: this.workItemsPerGroup
  });
};

mix.prototype.process = async function(srcArray, dst, pressure) {
  return await this.mixProgram.run({inputA: srcArray[0], inputB: srcArray[1], output: dst, width: this.width,
    pressure: pressure});
};

module.exports = mix;
