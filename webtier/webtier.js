
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
      return routes.addRoutesToServers(db, servers, config, (err) => {
        if (err) { console.error(`Failed to add servers`); }

        return next();
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
            return sg._404(req, res, null, `Host ${host} is known, path ${pathname} is not.`);
          }

          /* otherwise -- no Router() object; 400 */
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

      //
      // Determine config for nginx.conf
      //

      // ----- Config settings that are quasi-global -----
      var ngConfig = {
        webRootRoot   : path.join(process.env.HOME, 'www'),                             /* the root of all the web-roots */
        certsDir      : '/'+path.join('etc', 'nginx', 'certs'),                         /* the protected certs dir */
        openCertsDir  : path.join(process.env.HOME, 'tmp', 'nginx', 'certs'),           /* the certs dir for well-known certs */
        routesDir     : path.join(process.env.HOME, 'tmp', 'nginx', 'routes'),          /* the dir for loading extra per-server routes */
      };

      setOn(ngConfig, 'noCerts', isLocalWorkstation());

      // ----- Config for each server/fqdn -----
      var fileManifest = {};
      var ngServers = sg.reduce(servers, [], (m, server_, name) => {
        var   server      = sg.kv('fqdn', name);
        const fqdn        = name;
        const urlSafeName = fqdn.replace(/[^-a-z0-9_]/gi, '_');

        // Add attrs to server (like .useHttp / .useHttps / .requireClientCerts)
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
          setOn(fileManifest, [`${server.projectName}_client`,    'client'],   server.projectName);
          setOn(fileManifest, [`${server.projectName}_client`,    'certfile'], path.join(ngConfig.certsDir, clientCert));

          setOn(server, ['fileManifest', `${server.projectName}_client`], clientCert);
          setOn(server, 'clientCert', clientCert);
        }

        m.push(server);
        return m;
      });

      const info = {config, servers, fileManifest, ngConfig, ngServers};
      serverassist.writeDebug(info, 'webtier-generate.json');

      console.log('-');
      console.log('------------------------------------------- Config:');
      console.log(ngConfig);
      _.each(ngServers, ngServer => {
        console.log(sg.lpad(ngServer.fqdn, 35), _.pick(ngServer, 'useHttp', 'useHttps', 'requireClientCerts'));
      });
      console.log('------------------------------------------- /Config');
      console.log('-');

      //
      // ---------- Build the nginx.conf file ----------
      //

      // The bash script to run that generates self-signed scripts
      const genSelfSignedCertScript   = path.join(__dirname, 'scripts', 'gen-self-signed-cert');

      // The temp nginx.conf file (generated here before the `nginx -t [conffile]`).
      const confFilename              = '/tmp/server-assist-nginx.conf';

      return sg.__runll([function(next) {

        // Loop over the file manifest, and generate any needed files
        return sg.__each(fileManifest, function(fileGroup, next) {

          // We can only do self-signed certs here
          if (!fileGroup.keyfile) { return next(); }

          // Run the script to generate self-signed certs for our fqdns
          const args = [fileGroup.keyfile, fileGroup.certfile, fileGroup.cn];
          return sg.exec(genSelfSignedCertScript, args, function(err, exitCode, stdoutChunks, stderrChunks, signal) {
            if (err)  { conole.error(err); return next(); }

            reportOutput(`gen-self-signed(${fileGroup.cn})`, err, exitCode, stdoutChunks, stderrChunks, signal);
            return next();
          });
        }, next );
      }, function(next) {

        // Write the file manifest
        const manifest = sg.reduce(fileManifest, [], (m, file) => {
          m.push(file);
          return m;
        });

        return fs.writeFile(path.join(process.env.HOME, 'sas-file-manifest.json'), JSON.stringify(manifest), (err) => {
          if (err)  { conole.error(err); return next(); }
          return next();
        });

      }, function(next) {

        // Generate the nginx.conf file, and write it to /tmp/
        return generateNginxConf(ngConfig, ngServers, (err, conf) => {
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

          reportOutput(`reload-nginx`, err, exitCode, stdoutChunks, stderrChunks, signal);

          // No callback() here -- we are in main() and the code to run the Node.js server is above.
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

reportOutput = function(msg_, error, exitCode, stdoutChunks, stderrChunks, signal) {

  const msg         = sg.lpad(msg_+':', 50);
  const stdoutLines = _.compact(stdoutChunks.join('').split('\n'));
  const stderrLines = _.compact(stderrChunks.join('').split('\n'));

  if (stdoutLines.length === 1) {
    console.log(`${msg} exit: ${exitCode}, SIGNAL: ${signal}: ${stdoutLines[0]}`);
  } else {
    console.log(`${msg} exit: ${exitCode}, SIGNAL: ${signal}`);
    _.each(stdoutLines, line => {
      console.log(`${msg} ${line}`);
    });
  }

  const stderr = stderrChunks.join('');
  if (stderr.length > 0) {
    _.each(stderrLines, line => {
      console.error(`${msg} ${line}`);
    });
  }
};

if (sg.callMain(ARGV, __filename)) {
  main();
}


