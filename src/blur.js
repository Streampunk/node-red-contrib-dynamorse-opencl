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

const blurKernel = `
__constant sampler_t sampler =
      CLK_NORMALIZED_COORDS_FALSE
    | CLK_ADDRESS_CLAMP_TO_EDGE
    | CLK_FILTER_NEAREST;

__kernel void
  blur(__read_only image2d_t input,
       __write_only image2d_t output,
       __private unsigned int dim,
       __constant const float* restrict filter) {

    const int2 pos = { get_global_id(0), get_global_id(1) };
    const int size = dim / 2;

    float4 sum = (float4)(0.0f);
    for(int y = -size; y <= size; y++) {
      for(int x = -size; x <= size; x++) {
          sum += filter[(x+size) + (y+size)*(size*2 + 1)]
              * read_imagef(input, sampler, pos + (int2)(x,y));
      }
    }
    write_imagef(output, pos, sum);
  }
`;

function gaussianFilter(size, sigma) {
  const numEntries = size**2;
  const filterArr = new Float32Array(numEntries);

  let sum = 0.0;
  const hsize = (size / 2) >>> 0;
  for(let y = -hsize; y <= hsize; y++) {
    for(let x = -hsize; x <= hsize; x++) {
      const g = Math.exp(-(Math.pow(x,2)+Math.pow(y,2))/(2*Math.pow(sigma,2)))/(2*Math.PI*Math.pow(sigma,2));
      filterArr[(x+hsize) + (y+hsize)*(hsize*2 + 1)] = g;
      sum += g;
    }
  }

  // normalise
  for(let y = -hsize; y <= hsize; y++) {
    for(let x = -hsize; x <= hsize; x++) {
      filterArr[(x+hsize) + (y+hsize)*(hsize*2 + 1)] = filterArr[(x+hsize) + (y+hsize)*(hsize*2 + 1)] / sum;
    }
  }

  return filterArr;
}

function blur(node, context, width, height, blurDepth) {
  this.node = node;
  this.context = context;
  this.globalWorkItems = Uint32Array.from([ width, height ]);

  // calculate blur filter
  const sigma = blurDepth;
  this.dim = Math.min(11, Math.pow(Math.ceil(6*sigma), 2) | 1); // round up to next odd
  this.filterArray = gaussianFilter(this.dim, sigma);

  return this;
}

blur.prototype.init = async function() {
  this.filter = await this.context.createBuffer(this.filterArray.byteLength, 'readonly', 'none', this.node.ownerName);
  await this.filter.hostAccess('writeonly', Buffer.from(this.filterArray.buffer));

  this.blurProgram = await this.context.createProgram(blurKernel, {
    name: 'blur',
    globalWorkItems: this.globalWorkItems
  });
};

blur.prototype.process = async function(src, dst) {
  return await this.blurProgram.run({input: src, output: dst, dim: this.dim, filter: this.filter});
};

module.exports = blur;
