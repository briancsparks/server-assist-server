
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');

const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const configuration           = serverassist.configuration;

var main = function() {

  var r;

  return sg.__run2(function main2(next) {

    return once();

    function once() {
      sg.setTimeout(1000, once);

      // Make sure telemetry uploads are working - upload to telemetry/upload; use xapi to download

    }
  }, [function(next_) {

    return getConfig(next_);

    function getConfig(next__) {
      const next = next__ || function(){};

      // Kick off next config
      sg.setTimeout(10000, getConfig);

      return configuration({}, {}, (err, r_) => {
        if (sg.ok(err, r_)) {
          if (!sg.deepEqual(r_, r)) {
            console.log(`server-assist-server reconfig`);
            return reconfigure(r_, next);
          }
        }
        return next();
      });
    }
  }, function(next) {
    return next();
  }]);

  function reconfigure(r_, callback) {
    r = r_;
    return callback();
  }
};

main();

