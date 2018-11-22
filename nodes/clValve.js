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

const util = require('util');
const redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
const Grain = require('node-red-contrib-dynamorse-core').Grain;
const multiFlows = require('node-red-contrib-dynamorse-core').Multiflows;
  
function clValve (RED, config) {
  redioactive.Valve.call(this, config);

  const logLevel = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].indexOf(RED.settings.logging.console.level);
  let cableChecked = false;
  let setupError = null;
  let srcFlows = null;
  let dstID = {};

  this.doProcess = (grainSet, push) => {
    const grainTypes = Object.keys(grainSet);
    grainTypes.forEach(t => {
      const srcBufArray = [];
      grainSet[t].forEach(g => srcBufArray.push(g.grain.buffers[0]));
      const time = process.hrtime();
      this.processGrain(t, srcBufArray)
        .then (result => {
          var diff = process.hrtime(time);
          this.log(`Process took ${(diff[0] * 1e9 + diff[1])/1e6} milliseconds`);

          const x = grainSet[t][0].grain;
          push(null, new Grain(result, x.ptpSync, x.ptpOrigin,
            x.timecode, dstID[t].flowID, dstID[t].sourceID, x.duration));
          grainSet[t].forEach(g => g.next());
        })
        .catch(err => push(err));
    });
  };

  this.consume((err, x, push, next) => {
    if (err) {
      push(err);
      next(redioactive.noTiming);
    } else if (redioactive.isEnd(x)) {
      this.quit(() => {
        push(null, x);
      });
    } else if (Grain.isGrain(x)) {
      const nextJob = (cableChecked) ?
        Promise.resolve(x) :
        this.findCable(x).then(cable => {
          if (cableChecked)
            return x;

          cableChecked = true;
          const selCable = this.getProcessSources(cable);

          let outCableSpec = {};
          selCable.forEach(c => {
            const cableTypes = Object.keys(c);
            cableTypes.forEach(t => {
              if (c[t] && Array.isArray(c[t])) {
                const srcTags = c[t][0].tags;
                const dstTags = this.makeDstTags(srcTags);
                if (('video' === dstTags.format) && outCableSpec[t])
                  // if either input is interlaced, set the output as interlaced
                  dstTags.interlace = dstTags.interlace || outCableSpec[t][0].tags.interlace;
                outCableSpec[t] = [{ tags: dstTags }];
              }
            });
          });
          outCableSpec.backPressure = 'video[0]';

          const outCable = this.makeCable(outCableSpec);
          const formattedCable = JSON.stringify(outCable, null, 2);
          RED.comms.publish('debug', {
            format: `${config.type} output cable:`,
            msg: formattedCable
          }, true);

          let dstTags = {};
          const cableTypes = Object.keys(outCable);
          cableTypes.forEach(t => {
            if (outCable[t] && Array.isArray(outCable[t])) {
              dstID[t] = { flowID: outCable[t][0].flowID, sourceID: outCable[t][0].sourceID };
              dstTags[t] = outCable[t][0].tags;
            }
          });

          srcFlows = new multiFlows(selCable);
          return this.setInfo(srcFlows.getTags(), dstTags, logLevel)
            .then(() => x);
        });

      nextJob.then(x => {
        if (setupError) {
          push(setupError);
          return next(redioactive.noTiming);
        }
        else {
          const queue = srcFlows.checkID(x);
          if (queue) {
            const grainSet = srcFlows.addGrain(x, queue, next);
            if (grainSet) {
              this.doProcess (grainSet, push);
            }
          } else {
            this.log(`${config.type} dropping grain with flowID ${x.flow_id}`);
            return next(redioactive.noTiming);
          }
        }
      }).catch(err => {
        if (!setupError) {
          setupError = err;
          console.log(setupError);
        }
        push(setupError);
        next(redioactive.noTiming);
      });
    } else {
      push(null, x);
      next(redioactive.noTiming);
    }
  });

  this.on('close', () => this.closeValve());
}
util.inherits(clValve, redioactive.Valve);

module.exports = clValve;
