
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = require('serverassist');
const http                    = require('http');
const fs                      = require('fs');
const path                    = require('path');
const urlLib                  = require('url');
const routes                  = require('./routes/routes');
const MongoClient             = require('mongodb').MongoClient;
const ra                      = require('run-anywhere');
const libBuildNginxConf       = require('./ra-scripts/build-nginx-conf');

const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const isLocalWorkstation      = serverassist.isLocalWorkstation;

var   ARGV                    = sg.ARGV();
const mongoHost               = serverassist.mongoHost();
const myIp                    = serverassist.myIp();
const buildNginxConf          = ra.contextify(libBuildNginxConf.build);

var   dumpReq;

const appName                 = 'webtier_router';
const port                    = 8401;

var servers = {};

const main = function() {

  const fqdnStr = ARGV.fqdn || ARGV.fqdns || '';
  const fqdns   = fqdnStr.split(',');

  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    // The apps that we will be aware of
    var apps = [];

    sg.__run([function(next) {

      // Add into apps a web-root object, if we are on a workstation
      if (!isLocalWorkstation())  { return next(); }

      // ---------- Listen at root for dev workstations ----------
      console.log('--------- loading for workstation');

      // If we are on a local workstation, handle root as being sent to :3000, the typical
      // Node.js port.  We add an app object (same format as whats in the apps collection
      // in the DB.), and then inform that there is a webtier_router service.
      apps.push({appId:'web_root', mount:'/', projectId:'sa'});

      // On workstation, add local.mwa.net as an endpoint. It is in DNS as 127.0.0.1
      //fqdns.unshift('local.mobilewebassist.net');

      registerMyService();

      return next();

      function registerMyService() {
        setTimeout(registerMyService, 750);
        registerAsService('web_root', `http://${myIp}:3000`, myIp, 4000);
      }

    }, function(next) {

      // ----------- Load apps from the DB ----------
      return routes.addRoutesToServers(db, servers, apps, (err) => {
        if (err) { console.error(`Failed to add servers`); }

        return next();
      });

    }, function(next) {

      // ---------- Run the server ----------
      const server = http.createServer((req, res) => {
        return sg.getBody(req, function() {
          dumpReq(req, res);

          const pathname      = urlLib.parse(req.url).pathname;

          const host          = req.headers.host;
          const serverRoutes  = servers[host] && servers[host].router;

          if (serverRoutes) {
            const route       = serverRoutes.match(pathname);

            if (route && _.isFunction(route.fn)) {
              return route.fn(req, res, route.params, route.splats, route);
            }

            /* otherwise -- Did not match the route to any handler */
            return sg._404(req, res, `${host} / ${pathname}`);
          }

          /* otherwise */
          return sg._400(req, res);
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

      // ---------- Build the nginx.conf file ----------

      // Generate the contents
      return buildNginxConf({fqdns: _.keys(servers)}, function(err, conf) {
        if (err) { return sg.die(err, `Failed build nginx.conf file`); }

        // Save the file to a tmp location
        var confFilename = '/tmp/server-assist-nginx.conf';
        return fs.writeFile(confFilename, conf, function(err) {
          if (err) { return sg.die(err, `Failed save nginx.conf /tmp/ file`); }

          const cmd   = path.join(__dirname, 'scripts', 'reload-nginx');
          const args  = [confFilename];

          // Run a shell script that copies it to the right place and restats nginx
          return sg.exec(cmd, args, (err, exitCode, stdoutChunks, stderrChunks, signal) => {
            if (err)                        { console.error(`Failed to (re)start nginx`); }
            if (exitCode !== 0 || signal)   { console.log(`${cmd}: exit: ${exitCode}, signal: ${signal}`); }

            console.log(stdoutChunks.join(''));
            console.error(stderrChunks.join(''));

          });
        });
      });
    });
  });
};

dumpReq = function(req, res) {
  if (sg.verbosity() >= 3) {
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('--------');
  }
};

if (sg.callMain(ARGV, __filename)) {
  main();
}


