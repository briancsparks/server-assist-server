
/**
 *  Handles hq.mobilewebassist.net requests.
 *
 *      /clientStart
 */
const sg                      = require('sgsg');
const _                       = sg._;
const http                    = require('http');
const urlLib                  = require('url');
const serverassist            = sg.include('serverassist') || require('serverassist');
const MongoClient             = require('mongodb').MongoClient;
const router                  = require('routes')();
const routes                  = require('./routes/routes');

const ARGV                    = sg.ARGV();
const mkAddRoute              = serverassist.mkAddRoute;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const registerAsService       = serverassist.registerAsService;
const mongoHost               = serverassist.mongoHost();
const myIp                    = serverassist.myIp();

const appName                 = 'sa_hq';
const mount                   = '/sa/';
const projectId               = 'sa';

const main = function() {
  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    const port                = ARGV.port || 8400;
    const myServiceLocation   = `http://${myIp}:${port}`;

    const addRoute            = mkAddRoute(appName, router, myServiceLocation);

    return sg.__run([function(next) {
      // Do whatever for this specific server
      return next();

    // Load routes
    }, function(next) {
      return routes.addRoutes(addRoute, db, (err) => {
        if (err)      { return sg.die(err, `Could not add routes`); }

        return next();
      });

    }, function(next) {
      // ---------- Run the server ----------
      const server = http.createServer((req, res) => {
        return sg.getBody(req, function() {

          const pathname      = urlLib.parse(req.url).pathname;
          const host          = req.headers.host;
          const match         = router.match(pathname);

          if (match && _.isFunction(match.fn)) {
            return match.fn(req, res, match.params, match.splats, match);
          }

          /* otherwise -- Did not match the route to any handler */
          return sg._404(req, res, null, `Host ${host} is known, path ${pathname} is not.`);
        });
      });

      // ---------- Listen on --port ----------
      server.listen(port, myIp, () => {
        //console.log(`${appName} running HQ at http://${myIp}:${port}/`);

        //console.log(`Registering app ${appName}, mount: ${mount}, id: ${projectId}`);
        registerAsServiceApp(appName, mount, {projectId, subdomain:'hq.'});
        registerMyService();

        next();

        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(appName, myServiceLocation, myIp, 4000);
        }
      });

    }], function() {
      // Setup complete
    });
  });
};

if (sg.callMain(ARGV, __filename)) {
  main();
}

