
/**
 *  For working on a local workstation.
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const urlLib                  = require('url');
const path                    = require('path');

const revProxy                = serverassist.revProxy;
const configuration           = serverassist.configuration;

const HOME                    = process.env.HOME;
const USER                    = process.env.USER;
const appName                 = 'localhost';
const projectId               = 'sa';
const appId                   = `${projectId}_${appName}`;
const mount                   = `*/api/v1/${appName}/`;

const appRecord = {
  projectId,
  mount,
  appId,
  route               : `*/api/v:version/${appName}/`,
  isAdminApp          : false,
  useHttp             : true,
  useHttps            : true,
  requireClientCerts  : false
};


var lib = {};

lib.addRoutes = function(addRoute, onStart, db /*, addRawRoute, callback */) {
  var   args          = _.rest(arguments, 3);
  const callback      = args.pop();
  const addRawRoute   = args.shift();
  var   r;

  // The destination server that we are going to reverse-proxy to
  var   destUrlObj    = _.pick(urlLib.parse('https://console.mobilewebassist.net'), 'protocol', 'host');

  //-------------------------------------------------------------------------------------------------
  /**
   *  Handles /
   *
   *    /
   *
   */
  const root = function(req, res, params, splats, query) {

    var args = [];

    // Must use client certs, and might as well use SSL correctly
    args.push('--cert', path.join(HOME, '.ssh/keys/serverassist/client-certs', USER+'_mobilewebassist_client.pem'));
    args.push('--cacert', path.join(HOME, '.ssh/keys/serverassist/mobilewebassist_root_server_ca.crt'));

    // Hand off the work
    return revProxy(req, res, destUrlObj, {args});
  };
  //-------------------------------------------------------------------------------------------------


  // ------------------------------------------------------------------------------------------------
  //
  //  Run the startup logic (set things up for the above handlers.)
  //

  return sg.__run([function(next) {

    return configuration({}, {}, (err, r_) => {
      if (err) { return sg.die(err, callback, `sa_${appName}.addRoutes.configuration`); }

      r = r_;

      _.each(r.result.app_prj, (app_prj, app_prjName) => {
        if (app_prj.app.appId !== appId) { return; }    /* this is not my app */
        //console.log(`my app: ${app_prjName}`, sg.inspect(app_prj));
      });

      return next();
    });

  }, function(next) {

    //
    //  Add routes for the public APIs
    //

    console.log(`  -- sa_localhost public routes:`);
    addRawRoute('/:service/:type/v:version/:project', '/*',  root, appId);
    addRawRoute('/:project',                          '/*',  root, appId);

    // In reality, we just have to handle all requests
    addRawRoute('',                                   '/*',  root, appId);

    return next();

  }], function() {
    return callback();
  });

};

_.each(lib, (value, key) => {
  exports[key] = value;
});


