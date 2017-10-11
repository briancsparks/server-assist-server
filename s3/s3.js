
/**
 *  Serve S3 functionality via HTTP.
 *
 *  This file is just the Node.js server.
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');

const ARGV                    = sg.ARGV();

const myName                  = 's3.js';
const publicRoutes            = ['routes/s3-get'];
const xapiRoutes              = [];

const main = function() {
  const routes = [...(ARGV.public? publicRoutes:[]), ...(ARGV.xapi? xapiRoutes:[])];

  // My chance to load routes or on-starters
  const addModRoutes = function(addRoute, onStart, db /*, rawAddRoute, callback*/) {
    var   args          = _.rest(arguments, 3);
    const callback      = args.pop();
    const addRawRoute   = args.shift();

    return callback();
  };

  const addFinalRoutes = function(addRoute, onStart, db /*, rawAddRoute, callback*/) {
    var   args          = _.rest(arguments, 3);
    const callback      = args.pop();
    const addRawRoute   = args.shift();

    return callback();
  };

  var   params = {
    port        : ARGV.port || 8106,
    rawRoutes   : true,
    routes,
    addModRoutes,
    addFinalRoutes,
    __dirname
  };

  return serverassist.loadHttpServer(myName, params, (err, server, db) => {
    if (err)    { return sg.die(err, 'loading-http-server'); }

    console.log(`${myName} up`);
  });
};

main();


