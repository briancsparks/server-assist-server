
const sg                      = require('sgsg');
const _                       = sg._;
const request                 = sg.extlibs.superagent;
const serverassist            = sg.include('serverassist') || require('serverassist');
const http                    = require('http');
const fs                      = require('fs');
const path                    = require('path');
const urlLib                  = require('url');
const routes                  = require('./routes/routes3');
const MongoClient             = require('mongodb').MongoClient;
const ra                      = require('run-anywhere');
const libBuildNginxConf       = require('./ra-scripts/build-nginx-conf');

const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const isLocalWorkstation      = serverassist.isLocalWorkstation;
const generateNginxConf       = serverassist.server.generateNginxConf;

var   ARGV                    = sg.ARGV();
const setOn                   = sg.setOn;
const mongoHost               = serverassist.mongoHost();
const myIp                    = serverassist.myIp();
const myStack                 = serverassist.myStack();
const myColor                 = serverassist.myColor();
const buildNginxConf          = ra.contextify(libBuildNginxConf.build);

var   dumpReq, dumpReq_;

const configurationFilename   = path.join(process.env.HOME, 'configuration.json');
const appName                 = 'webtier_router';
const port                    = 8401;

var servers = {};
var config  = {};
var configuration;

const main = function() {

  const fqdnStr = ARGV.fqdn || ARGV.fqdns || '';
  const fqdns   = fqdnStr.split(',');

  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    // The apps that we will be aware of
    config.apps   = [];
    config.stack  = myStack;

    sg.__run([function(next) {

      //
      //  Special processing for running on a workstation
      //

      // Add into apps a web-root object, if we are on a workstation
      if (!isLocalWorkstation())  { return next(); }

      // ---------- Listen at root for dev workstations ----------
      console.log('--------- loading for workstation');

      // If we are on a local workstation, handle root as being sent to :3000, the typical
      // Node.js port.  We add an app object (same format as whats in the apps collection
      // in the DB.), and then inform that there is a webtier_router service.
      config.apps.push({appId:'web_root', mount:'/', projectId:'sa'});

      // On workstation, add local.mwa.net as an endpoint. It is in DNS as 127.0.0.1
      //fqdns.unshift('local.mobilewebassist.net');

      registerMyService();

      return next();

      function registerMyService() {
        setTimeout(registerMyService, 750);
        registerAsService('web_root', `http://${myIp}:3000`, myIp, 4000);
      }

    }, function(next) {

      //
      //  Load routes from apps
      //

      // ----------- Load apps from the DB ----------
      return routes.addRoutesToServers(db, servers, config, (err, configuration_) => {
        if (err) { console.error(`Failed to add servers`); }

        configuration = configuration_;
        return fs.writeFile(configurationFilename, JSON.stringify(configuration), (err) => {
          return next();
        });
      });

    }, function(next) {

      //
      //  Run the Node.js http server loop.
      //

      // ---------- Run the server ----------
      const server = http.createServer((req, res) => {
        return sg.getBody(req, function() {
          dumpReq(req, res);

          // Get routing info
          const host          = req.headers.host;
          const pathname      = urlLib.parse(req.url).pathname;

          // Get the Router() object for the host.
          const serverRoutes  = servers[host] && servers[host].router;

          // If we got a Router() object, route to it.
          if (serverRoutes) {
            const route       = serverRoutes.match(pathname);

            if (route && _.isFunction(route.fn)) {
              return route.fn(req, res, route.params, route.splats, route);
            }

            /* otherwise -- Did not match the route to any handler */
            const msg = `Webtier: Host ${host} is known, path ${pathname} is not.`;
            console.error(msg);
            return serverassist._404(req, res, null, msg);
          }

          /* otherwise -- no Router() object; 400 */
          const msg = `Webtier: Host ${host} is unknown.`;
          console.error(msg);
          dumpReq_(req, res);
          return serverassist._400(req, res, null, msg);
        });
      });

      // ---------- Listen on --port ----------
      server.listen(port, myIp, () => {
        console.log(`${appName} running at http://${myIp}:${port}/`);
        console.log('');

        // Inform of my webtier_router service
        registerMyService();

        next();

        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(appName, `http://${myIp}:${port}`, myIp, 4000);
        }
      });

    }], function() {


      const config = configuration.result.subStacks[`${myColor}-${myStack}`];

      // The temp nginx.conf file (generated here before the `nginx -t [conffile]`).
      const confFilename              = '/tmp/server-assist-nginx.conf';

      return sg.__run([function(next) {

        return generateNginxConf(config, (err, conf) => {
          //console.log(conf);

          return fs.writeFile(confFilename, conf, function(err) {
            if (err) { return sg.die(err, `Failed save nginx.conf /tmp/ file`); }
            return next();
          });
        });

      }], function() {

        // Call the script that reloads nginx.
        const cmd   = path.join(__dirname, 'scripts', 'reload-nginx');
        const args  = [confFilename];

        // Run a shell script that copies it to the right place and restats nginx
        return sg.exec(cmd, args, (err, exitCode, stdoutChunks, stderrChunks, signal) => {
          if (err)                        { console.error(`Failed to (re)start nginx`); }

          sg.reportOutput(`reload-nginx`, err, exitCode, stdoutChunks, stderrChunks, signal);

          // No callback() here -- we are in main() and the code to run the Node.js server is above.
        });
      });
    });
  });
};

dumpReq_ = function(req, res) {
  console.log(req.method, req.url);
  _.each(req.headers, function(value, key) {
    console.log(sg.pad(key, 20), value);
  });
  console.log(sg.inspect(req.bodyJson));
  console.log('--------');
};

dumpReq = function(req, res) {
  if (sg.verbosity() >= 3) {
    return dumpReq_(req, res);
  }
};

if (sg.callMain(ARGV, __filename)) {
  main();
}


