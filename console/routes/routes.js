
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const consoleRoutes           = require('./console-route');

var lib = {};

lib.addRoutes = function(addRoute, onStart, db, callback) {
  return sg.__run([function(next) {
    return consoleRoutes.addRoutes(addRoute, onStart, db, next);
  }], function() {
    return callback();
  });
};

_.each(lib, (v,k) => {
  exports[k] = v;
});

