
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = sg.include('serverassist') || require('serverassist');
const fs                      = sg.extlibs.fsExtra;
const path                    = require('path');
const AWS                     = require('aws-sdk');

const ARGV                    = sg.ARGV();
const verbose                 = sg.verbose;
const setOnn                  = sg.setOnn;
const deref                   = sg.deref;
const argvGet                 = sg.argvGet;
const argvExtract             = sg.argvExtract;
const safeNewRegExp           = sg.safeNewRegExp            || mySafeNewRegExp;
const mkXapiAppProjectId      = sg.mkXapiAppProjectId       || myMkXapiAppProjectId;
const anyIsnt                 = sg.anyIsnt                  || myAnyIsnt;
const ap                      = sg.ap                       || myAp;
const _extend                 = myExtend;
const myColor                 = serverassist.myColor();
const myStack                 = serverassist.myStack();
const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const configuration           = serverassist.configuration;
const _200                    = serverassist._200;
const _400                    = serverassist._400;
const _403                    = serverassist._403;
const _404                    = serverassist._404;
const _500                    = serverassist._500;

const myAppName               = 's3';
const projectId               = 'sa';
const appId                   = `${projectId}_${myAppName}`;
const mount                   = `*/api/v1/${myAppName}/`;

const appRecord = {
  projectId,
  mount,
  appId,
  route               : `*/api/v:version/${myAppName}/`,
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

  var   projects      = {};
  var   accessRules   = {};

  var s3 = new AWS.S3();

  //-------------------------------------------------------------------------------------------------
  /**
   *  Sends a file from S3.
   *
   *    /sendS3File
   *
   *  This is the function that deals with S3, and sends the serverResponse. Other functions
   *  parse the URL and body to understand the request, and then call this function.
   *
   *  * Parses input to create params for the S3 getObject() call.
   *  * Calls S3 getObject()
   *  * Parses the S3 object as JSON if it has the right content-type; returns as JSON.
   *  * Otherwise, returns as the S3 content-type
   *
   */
  const sendS3File = function(req, res, argv, app_prjName) {
    const projectId   = argvGet(argv, 'project-id,projectId');
    const s3Args      = _.omit(argv, 'projectId,version,splats'.split(','));

    const start       = _.now();
    const Bucket      = argvExtract(s3Args, 'bucket');
    const Key         = argvExtract(s3Args, 'key');
    const delay       = argvExtract(s3Args, 'delay');

    if (!Bucket)      { return _400(req, res, 'Must provide Bucket'); }
    if (!Key)         { return _400(req, res, 'Must provide Key'); }
    if (!projectId)   { return _400(req, res, 'No projectId found'); }

    var   allowingRule;
    const allowRules  = deref(projects, [app_prjName, 'accessRules', 'allow']) || [];
    const allow       = sg.reduce(allowRules, null, (m, rule) => {
      if (Bucket.match(rule.bucket) && Key.match(rule.key)) { allowingRule = rule; return true; }
      return m;
    }) || false;

    if (allow) {
      verbose(2, {allowingRule});
    } else {
      verbose(2, {allow}, {allowRules});
    }

    if (!allow)       { return _403(req, res, `Access denied to ${Bucket}/${Key}`); }

    return sg.__run2({}, [function(result, next, last, abort) {

      const params = sg.reduce(s3Args, {Bucket, Key}, (m, value, key) => {
        return sg.kv(m, key, value);
      });

      return s3.getObject(params, (err, data) => {
        if (err) {
          console.log(_.pick(err, 'message,code,statusCode'.split(',')));
          if (err.statusCode === 404)   { return _404(req, res, err.code || 'Not Found'); }
          return _400(req, res, err);
        }

        //console.log(err, _.keys(data), _.omit(data, 'Body'), data.Body.length, typeof data.Body);

        // If its JSON, return as such
        if (data.ContentType === 'application/json') {
          _.extend(result, sg.safeJSONParse(data.Body) || data.Body);
          return next();
        }

        /* otherwise -- return according to the metadata that S3 has */
        if (sg.isnt(delay)) {
          return doit();
        }

        /* othewise */
        const elapsed = _.now() - start;
        return sg.setTimeout(delay - elapsed, doit);

        function doit() {
          res.writeHead(200, {
            'Content-Type'    : data.ContentType,
            'Content-Length'  : data.ContentLength
          });
          res.end(data.Body);
        }

      });

    }], function last(err, result) {
      if (sg.isnt(delay)) {
        return doit();
      }

      /* othewise */
      const elapsed = _.now() - start;
      return sg.setTimeout(delay - elapsed, doit);

      function doit() {
        return _200(req, res, result);
      }
    }, function abort(err, msg) {
      if (msg)  { return _404(req, res, msg); }
      return _400(err);
    });

  };

  //-------------------------------------------------------------------------------------------------
  /**
   *  Handles xs3get
   *
   *    /xs3get
   *
   */
  const xs3get = function(req, res, params_, splats, query) {
    const argv        = _extend(req.bodyJson || {}, params_ || {}, query || {}, {splats});
    const projectId   = argvGet(argv, 'project-id,projectId');

    const app_prjName = _.compact([projectId, 'xapi', myAppName /*s3*/, argv.version]).join('_');
    return sendS3File(req, res, argv, app_prjName);
  };

  //-------------------------------------------------------------------------------------------------
  /**
   *  Handles s3get
   *
   *    /s3get
   *
   */
  const s3get = function(req, res, params_, splats, query) {
    const argv        = _extend(req.bodyJson || {}, params_ || {}, query || {}, {splats});
    const projectId   = argvGet(argv, 'project-id,projectId');

    const app_prjName = _.compact([projectId, myAppName /*s3*/]).join('_');
    return sendS3File(req, res, argv, app_prjName);
  };

  //-------------------------------------------------------------------------------------------------


  // ------------------------------------------------------------------------------------------------
  //
  //  Run the startup logic (set things up for the above handlers.)
  //

  return sg.__run([function(next) {
    return registerAsServiceApp(appId, mount, appRecord, next);

  }, function(next) {
    return configuration({}, {}, (err, r_) => {
      if (err) { return sg.die(err, callback, `sa_${myAppName}.addRoutes.configuration`); }

      r = r_;

      // Determine the access rules to buckets and keys
      _.each(r.db.appprjRecords, appprjRecord => {
        if (appprjRecord.appName !== myAppName) { return; }

        // Get allowRules from the record
        accessRules[appprjRecord.appProjectId] = {allow: getRules(appprjRecord.allow)};
        setOnn(projects, [appprjRecord.appProjectId, 'accessRules', 'allow'], getRules(appprjRecord.allow));
        dumpRules(appprjRecord);

        // Get the allowRules for xapi
        if (appprjRecord.xapi) {
          const appprjxId   = mkXapiAppProjectId(appprjRecord.appProjectId, appprjRecord.xapi.version);

          if (appprjxId) {
            setOnn(projects, [appprjRecord.appProjectId, 'xapis', appprjxId, 'version'], appprjRecord.xapi.version);

            accessRules[appprjxId] = {allow: getRules(appprjRecord.xapi.allow)};
            setOnn(projects, [appprjxId, 'accessRules', 'allow'], getRules(appprjRecord.xapi.allow));
            dumpRules(appprjRecord.xapi, appprjxId);
          }
        }
      });

      return next();

      function getRules(rules) {
        return _.map(rules || [], rule => {
          const bucket  = safeNewRegExp('^', rule.bucket, '$');
          const key     = safeNewRegExp('^', rule.key);

          return _extend(rule, {bucket}, {key});
        });
      }

      function dumpRules(record, projectId_) {
        const projectId = projectId_ || record.appProjectId;
        console.log(`  -- ${projectId}:`);
        _.each(record.allow || [], rule => {
          console.log(`           s3://${rule.bucket}/${rule.key || ''}`);
        });
      }
    });

  }, function(next) {

    //
    //  Add routes for the public APIs
    //

    console.log(`  -- s3 public routes:`);
    _.each(r.result.app_prj, (app_prj, app_prjName) => {
      if (app_prj.app.appId !== appId)        { return; }    /* this is not my app */
      if (!projects[app_prjName])             { return; }    /* this is not my app */

      const [projectId, appName]  = app_prjName.split('_');
      const myMount               = deref(app_prj, [myStack, myColor, 'mount']) || '';

      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get`,                  s3get, app_prjName, true);
      //addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/:Bucket/:Key`,     s3get, app_prjName, true);      // Does not work right, yet
      //addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/:Bucket/:Key/*`,   s3get, app_prjName, true);      // Does not work right, yet
      addRoute(`/:projectId(${projectId})/api/v:version/${appName}`, `/get/*`,                s3get, app_prjName, true);

      // Add startup notification handler for S3
      onStart.push(function(port, myIp) {
        const myServiceLocation   = `http://${myIp}:${port}`;

        console.log(`${sg.pad(app_prjName, 35)} [${myServiceLocation}] (for /${myMount})`);
        registerMyService();

        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(app_prjName, myServiceLocation, myIp, 4000);
        }
      });

      // Setup routes for xapis
      console.log(`  -- s3 xapi routes:`);
      _.each(deref(projects, [app_prjName, 'xapis']), (xapi, xapiId) => {
        //const project = projects[xapiId];
        addRoute(`/${appName}/xapi/v:version/:projectId(${projectId})`, `/get`,                  xs3get, xapiId, true);

        // Add startup notification handler for S3 xapi
        onStart.push(function(port, myIp) {
          const myServiceLocation   = `http://${myIp}:${port}`;

          console.log(`${sg.pad(xapiId, 35)} [${myServiceLocation}] (for /${appName}/xapi/v${xapi.version}/${projectId})`);
          registerMyService();

          function registerMyService() {
            setTimeout(registerMyService, 750);
            registerAsService(xapiId, myServiceLocation, myIp, 4000);
          }
        });
      });
    });

    return next();

  }], function() {
    return callback();
  });

};

_.each(lib, (value, key) => {
  exports[key] = value;
});

function myAp(a, v) {
  if (arguments.length === 1)   { return ap(null, a); }
  if (_.isUndefined(v))         { return []; }

  a = a || [];
  a.push(v);
  return a;
}

function myExtend() {
  var args = sg.reduce(arguments, [], (m, arg) => {
    return ap(m, sg.isObject(arg) ? sg.smartAttrs(arg) : arg);
  });

  args.unshift({});
  return _.extend.apply(_, args);
}

/**
 *  Returns false if any items in the argv Array fail sg.isnt().
 */
function myAnyIsnt(argv) {
  return sg.reduce(argv, false, (m, arg) => {
    if (m !== false) { return m; }
    return !arg;
  });
}

function mySafeNewRegExp() {
  if (anyIsnt(arguments)) { return /*undefined*/; }

  const str = _.toArray(arguments).join('');

  try {
    return new RegExp(str);
  } catch(e) {
  }

  return /*undefined*/;
}

/**
 *  Converts app-project id (like sa_s3) to the xapi version (like sa_xapi_s3_1).
 */
function myMkXapiAppProjectId(id, version) {
  const parts = id.split('_');
  return `${parts[0]}_xapi_${parts[1]}_${version}`;
}


