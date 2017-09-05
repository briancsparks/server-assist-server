
/**
 *  This is the boring loader file for the telemetry module.
 *
 *  This is the entry point, but all it does is load other things, so they
 *  can do the real work.
 *
 *    routes/telemetry-routes.js   -- Handles uploads.
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');

const ARGV                    = sg.ARGV();

const myName                  = 'sa-telemetry.js';
const publicRoutes            = [];
const xapiRoutes              = ['routes/xapi-routes'];

const main = function() {
  const routes = [...(ARGV.xapi? xapiRoutes:[]), ...(ARGV.public? publicRoutes:[])];

  // My chance to load routes or on-starters
  const addModRoutes = function(addRoute, onStart, db, callback) {
    return callback();
  };

  const addFinalRoutes = function(addRoute, onStart, db, callback) {
    return serverassist.defAddFinalRoutes(addRoute, onStart, db, callback);
  };

  var   params = {
    port        : ARGV.port || 8107,
    routes,
    addModRoutes,
    addFinalRoutes,
    __dirname
  };

  return serverassist.loadHttpServer(myName, params, (err, server, db) => {
    if (err)    { return sg.die(err, 'loading-http-server'); }

    //console.log(`${myName} up`);
  });
};

main();

