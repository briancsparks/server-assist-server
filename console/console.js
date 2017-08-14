
/**
 *  Handles console.mobilewebassist.net requests.
 *
 *      /clientStart
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const http                    = require('http');
const urlLib                  = require('url');
const MongoClient             = require('mongodb').MongoClient;
const router                  = require('routes')();
const routes                  = require('./routes/routes');

const ARGV                    = sg.ARGV();
const mkAddRoute              = serverassist.mkAddRoute;
const myIp                    = serverassist.myIp();

const myName                  = 'console.js';

const main = function() {
  const dbName                = ARGV.dbName || 'serverassist';
  const port                  = ARGV.port   || 8402;

  const mongoHost             = serverassist.mongoHost(dbName);

  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    const myServiceLocation   = `http://${myIp}:${port}`;
    const addRoute            = mkAddRoute(myName, router, myServiceLocation);
    var   onStarters          = [];

    return sg.__run([function(next) {

      // Load routes
      return routes.addRoutes(addRoute, onStarters, db, (err) => {
        if (err)      { return sg.die(err, `Could not add routes`); }

        return next();
      });

    }, function(next) {
      // ---------- Run the server ----------
      const server = http.createServer((req, res) => {
        return sg.getBody(req, function() {

          const url           = urlLib.parse(req.url, true);
          const pathname      = url.pathname;
          const host          = req.headers.host;
          const match         = router.match(pathname);

          if (match && _.isFunction(match.fn)) {
            return match.fn(req, res, match.params, match.splats, url.query, match);
          }

          /* otherwise -- Did not match the route to any handler */
          return sg._404(req, res, null, `Host ${host} is known, path ${pathname} is not.`);
        });
      });

      // ---------- Listen on --port ----------
      server.listen(port, myIp, () => {
        console.log(`${myName} running console at http://${myIp}:${port}/`);

        _.each(onStarters, onStart => {
          onStart(port, myIp);
        });

        return next();
      });

    }], function() {
      // Setup complete
    });
  });
};

if (sg.callMain(ARGV, __filename)) {
  main();
}

