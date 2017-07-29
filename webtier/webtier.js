
const sg                      = require('sgsg');
const _                       = sg._;
const request                 = sg.extlibs.superagent;
const serverassist            = sg.include('serverassist') || require('serverassist');
const http                    = require('http');
const fs                      = require('fs');
const path                    = require('path');
const urlLib                  = require('url');
const routes                  = require('./routes/routes2');
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
const buildNginxConf          = ra.contextify(libBuildNginxConf.build);

var   dumpReq, reportOutput;

const appName                 = 'webtier_router';
const port                    = 8401;

var servers = {};
var config  = {};

const main = function() {

  const fqdnStr = ARGV.fqdn || ARGV.fqdns || '';
  const fqdns   = fqdnStr.split(',');

  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    // The apps that we will be aware of
    config.apps   = [];
    config.stack  = myStack;

    sg.__run([function(next) {

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

      // ----------- Load apps from the DB ----------
      return routes.addRoutesToServers(db, servers, config, (err) => {
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
            return sg._404(req, res, null, `Host ${host} is known, path ${pathname} is not.`);
          }

          /* otherwise */
          return sg._400(req, res, null, `Host ${host} is unknown.`);
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

      // ---------- Determine configuration for nginx.conf ----------

      // Config settings that are quasi-global
      var ngConfig = {
        webRootRoot   : path.join(process.env.HOME, 'www'),
        certsDir      : '/'+path.join('etc', 'nginx', 'certs'),
        openCertsDir  : path.join(process.env.HOME, 'tmp', 'nginx', 'certs'),
        routesDir     : path.join(process.env.HOME, 'tmp', 'nginx', 'routes'),
      };

      setOn(ngConfig, 'noCerts', isLocalWorkstation());

      // Config for each server/fqdn
      var fileManifest = {};
      var ngServers = sg.reduce(servers, [], (m, server_, name) => {
        var server = sg.kv('fqdn', name);
        const fqdn        = name;
        const urlSafeName = fqdn.replace(/[^-a-z0-9_]/gi, '_');

        // Add attrs to server .useHttp / .useHttps / .requireClientCerts
        _.each(server_.config, (value, key) => {
          setOn(server, key, value);
        });

        // If the server is to use https, where are the certs going?
        if (server.useHttps) {
          setOn(fileManifest, [urlSafeName, 'fqdn'],     fqdn);
          setOn(fileManifest, [urlSafeName, 'cn'],       fqdn);
          setOn(fileManifest, [urlSafeName, 'keyfile'],  path.join(ngConfig.openCertsDir, fqdn+'.key'));
          setOn(fileManifest, [urlSafeName, 'certfile'], path.join(ngConfig.openCertsDir, fqdn+'.crt'));

          setOn(server, ['fileManifest', urlSafeName], fileManifest[urlSafeName]);
        }

        // What about the client root cert?
        if (server.requireClientCerts) {
          const clientCert = `${server.projectName}_root_client_ca.crt`;
          setOn(fileManifest, [`${server.projectName}_client`,    'certfile'], path.join(ngConfig.certsDir, clientCert));

          setOn(server, ['fileManifest', `${server.projectName}_client`], clientCert);
          setOn(server, 'clientCert', clientCert);
        }

        m.push(server);
        return m;
      });

      const info = {config, servers, ngConfig, ngServers};
      serverassist.writeDebug(info, 'webtier-generate.json');

      //
      // ---------- Build the nginx.conf file ----------
      //

      const confFilename = '/tmp/server-assist-nginx.conf';
      const genSelfSignedCert = path.join(__dirname, 'scripts', 'gen-self-signed-cert');
      return sg.__runll([function(next) {
        return sg.__each(fileManifest, function(fileGroup, next) {

          // We can only do self-signed certs here
          if (!fileGroup.keyfile) { return next(); }

          const args = [fileGroup.keyfile, fileGroup.certfile, fileGroup.cn];
          return sg.exec(genSelfSignedCert, args, function(error, exitCode, stdoutChunks, stderrChunks, signal) {
            if (err)  { conole.error(error); return next(); }

            reportOutput(`gen-self-signed(${fileGroup.cn}): ${exitCode} ${signal}`, error, exitCode, stdoutChunks, stderrChunks, signal);
            return next();
          });
        }, next );
      }, function(next) {

        return generateNginxConf(ngConfig, ngServers, (err, conf) => {
          return fs.writeFile(confFilename, conf, function(err) {
            if (err) { return sg.die(err, `Failed save nginx.conf /tmp/ file`); }

            return next();
          });
        });

      }], function() {
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

reportOutput = function(msg, error, exitCode, stdoutChunks, stderrChunks, signal) {
  const stdoutLines = _.compact(stdoutChunks.join('').split('\n'));
  console.log(`${msg}: ${stdoutLines[0]}`);

  stdoutLines.shift();
  if (stdoutLines.length > 0) {
    console.log('gss:', stdoutLines);
  }

  const stderr = stderrChunks.join('');
  if (stderr.length > 0) {
    console.error('gss:', stderr);
  }
};

if (sg.callMain(ARGV, __filename)) {
  main();
}


