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

const stampKernel = `
  __kernel void stamp(__global float4* restrict inputA,
                      __global float4* restrict inputB,
                      __global float4* restrict output,
                      __private unsigned int width,
                      __private unsigned int premultVal) {
    uint item = get_global_id(0);
    bool lastItemOnLine = get_local_id(0) == get_local_size(0) - 1;

    // 16 pixels per workItem
    uint numPixels = lastItemOnLine && (0 != width % 16) ? width % 16 : 16;
    uint numLoops = numPixels;

    uint off = width * get_group_id(0) + get_local_id(0) * 16;

    bool premultiplied = premultVal != 0;

    for (uint i=0; i<numLoops; ++i) {
      float4 rgbaInA = inputA[off];
      float4 rgbaInB = inputB[off];

      float a = rgbaInA.s3 * rgbaInB.s3;
      float k = premultiplied ? 1.0f : a;
      float4 rgbaOut = (float4)(rgbaInA.xyz * k + rgbaInB.xyz * (1.0f - a), 1.0f);
      output[off] = rgbaOut;

      off++;
    }
  }
`;

function stamp(node, context, width, height) {
  this.node = node;
  this.context = context;
  this.width = width;

  // process one image line per work group, 16 pixels per work item
  this.workItemsPerGroup = ((width + 15) / 16) >>> 0;
  this.globalWorkItems = this.workItemsPerGroup * height;

  return this;
}

stamp.prototype.init = async function() {
  this.stampProgram = await this.context.createProgram(stampKernel, {
    name: 'stamp',
    globalWorkItems: this.globalWorkItems,
    workItemsPerGroup: this.workItemsPerGroup
  });
};

stamp.prototype.process = async function(srcArray, dst, premultiplied) {
  return await this.stampProgram.run({inputA: srcArray[0], inputB: srcArray[1], output: dst, width: this.width,
    premultVal: premultiplied ? 1 : 0});
};

module.exports = stamp;
