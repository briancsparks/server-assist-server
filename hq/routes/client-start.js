
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;
//const serverassist            = require('serverassist');
const serverassist            = require('../../../serverassist');
const urlLib                  = require('url');

const setOn                   = sg.setOn;
const deref                   = sg.deref;
const skip                    = sg.skip;
const reason                  = sg.reason;
const isLocalWorkstation      = serverassist.isLocalWorkstation;
const models                  = serverassist.raScripts.models;
const getIds                  = serverassist.raScripts.getIds;

var lib = {};

lib.addRoutes = function(addRoute, db, callback) {
  var handlers = {}, determine = {}, translate = {}, determiness = {}, translators = {};

  const stacksDb    = db.collection('stacks');
  const onrampsDb   = db.collection('onramps');
  const projectsDb  = db.collection('projects');

  const isSpecialClient = function(clientId) {
    if (clientId === '7B9qPWSIRh2EXElr4IQcLyrV3540klkqpjLpVtRuElSxyzWU5Tct0pNqA7cJDgnJ')  { return true; }
    if (clientId && (clientId.length > 0 && clientId.length < 32))                        { return true; }

    return false;
  };

  return sg.__run(function main() {

    return projectsDb.find({}).toArray((err, projects_) => {
      if (err)  { return sg.die(err, callback, 'clientStart-main'); }

      // Loop over the kinds of determiness (deploy styles) we have
      var projects = sg.extend(projects_);
      _.each(determiness, (fn, fnDeployStyle) => {

        projects = _.filter(projects, project => {
          if (project.deployStyle === fnDeployStyle) {
            determiness[project.deployStyle](project.projectId, 'prod');
            return false;
          }

          return true;
        });
      });

      // Remaining projects get the justX style
      _.each(projects, project => {
        determiness.justX(project.projectId, 'prod');
      });

      // All projects are onramps
      var projects = sg.extend(projects_);
      _.each(projects, project => {
        translators.onramp(project.projectId);
      });

      addRoute('/:project/api/:version', '/clientStart', handlers.clientStart);
      addRoute('/:project',              '/clientStart', handlers.clientStart);

      return callback();
    });

  // ---------- The determine and translate functions ----------
  }, [function(next) {

    // ----- /clientStart -----
    handlers.clientStart = function(req, res, params, splats, match) {
      req.serverassist = {};

      const onError = function(error) {
        console.log('Client error while handling /clientStart', error);
        return sg._400(req, res, null, error);
      };

      const url     = urlLib.parse(req.url, true);
      const body    = req.bodyJson || req.body;
      const query   = url.query;

      const { projectId_, partnerId, clientId, version } = req.serverassist.ids = getIds({body, query, match});

      if (!version)                     { return onError('Must provide version'); }
      if (!projectId_ && !partnerId)    { return onError('Must provide project-id or partner-id'); }

      var projectId = projectId_;

      var   result = {};
      setOn(result, 'upstream',             'prod');
      setOn(result, 'preference.telemetry', true);

      return sg.__run([function(next) {

        // ----- Get the projectId -- it does not usually come along with requests
        if (!partnerId)   { return reason(`Cannot get project; no partnerId`, next); }

        req.serverassist.partner = {};
        return models.findPartner({partnerId}, function(err, partner) {
          if (err || !partner)    { return skip(`No partner ${partnerId} found.`, next); }

          req.serverassist.partner = partner;
          projectId = partner.projectId || projectId;
          return next();
        });

      // ----- get project from DB -----
      }, function(next) {
        if (!projectId)  { return onError(`do not have projectId`); }

        req.serverassist.project = {};
        return models.findProject({projectId}, function(err, project) {
          if (err || !project)    { return skip(`No project ${projectId} found.`, next); }

          req.serverassist.project = project;
          return next();
        });

      // ----- get client from DB -----
      }, function(next) {
        if (!clientId)  { return onError(`do not have clientId`); }

        req.serverassist.client = {};
        return models.findClient({clientId}, function(err, client) {
          if (err)      { return skip(`No client ${clientId} found.`, next); }
          if (!client)  { return next(); }

          req.serverassist.client = client;
          return next();
        });

      // ----- Build up the default response -----
      }, function(next) {

        const sa = req.serverassist || {};
        setOn(result, 'upstream',
                    (sa.client  && sa.client.upstream)  ||
                    (sa.partner && sa.partner.upstream) ||
                    (sa.project && sa.project.upstream));

        setOn(result, 'preference',
            sg.extend((result     && result.preference) || {},
                      (sa.project && sa.project.preference) || {},
                      (sa.partner && sa.partner.preference) || {},
                      (sa.client  && sa.client.preference)  || {}));

        return next();

      // ----- Find and call the determine function -----
      }, function(next) {

        var determine_;
        if (!projectId)                                               { return onError(`do not have projectId`); }

        determine_ = deref(determine, [projectId, version]) || deref(determine, projectId);

        if (!determine_)                                              { return onError(`do not have determine fn for ${projectId}.${version}`); }

        return determine_(req, res, match, result, function(err) {
          if (err)  { return onError(err); }
          return next();
        });

      // ----- Find and call the translate function -----
      }, function(next) {

        var translate_;
        if (!projectId)                                               { return onError(`do not have projectId`); }

        translate_ = deref(translate, [projectId, version]) || deref(translate, projectId);

        if (!translate_)                                              { return onError(`do not have translate fn for ${projectId}.${version}`); }

        return translate_(req, res, match, result, function(err) {
          if (err)  { return onError(err); }
          return next();
        });

      }], function() {
        return sg._200(req, res, result);
      });
    };

    var stackAlias_ = {
      prod    : {stack: 'pub',    state: 'main'},
      staging : {stack: 'pub',    state: 'next',   fallback: 'prod'},
      qa      : {stack: 'test',   state: 'main'},
      test    : {stack: 'test',   state: 'main'}
    };

    var stackAlias = function(stack) {
      const parts = stack.split('_');
      if (parts.length === 1) {
        return _.pick(stackAlias_[stack] || stackAlias_.prod, 'stack', 'state');
      }

      /* otherwise */
      if (parts.length === 2) {
        return {stack: parts[0], state: parts[1]};
      }

      /* otherwise */
      return _.pick(stackAlias_.prod, 'stack', 'state');
    };

    const stackFallback = function(stack) {
      const parts = stack.split('_');
      if (parts.length === 1) {
        return stackAlias_[stack] && stackAlias_[stack].fallback;
      }

      /* otherwise */
      if (parts[1] !== 'next') { return null; }

      /* otherwise */
      return [parts[0], 'main'].join('_');
    }

    const getServiceFromUpstream = function(upstream, partnerId, serviceName, callback) {
      var query = stackAlias(upstream || 'prod');

      if (partnerId) {
        query.partners = {$in:[partnerId]};
      }

      return stacksDb.find(query).toArray(function(err, stacks) {
        if (err || !stacks)       { return callback(); }
        if (stacks.length === 0)  { return callback(); }

        return getStackService(stacks[0].color, stacks[0].stack, serviceName, callback);
      });
    };

    /**
     *  Knows that the app has 'main' and 'next' style apps
     */
    determiness.greenBlueByService = function(projectName, serviceName_) {
      const serviceName = serviceName_ || projectName;

      determine[projectName] = function(req, res, match, result, callback) {

        return sg.__run([function(next) {
          return getServiceFromUpstream(result.upstream, req.serverassist.partnerId, serviceName, function(err, service) {
            if (err || !service)  { return next(); }    // Try the next option
            return callback(null, result);
          });

        }, function(next) {
          const fallback  = stackFallback(result.upstream);
          if (!fallback)  { return next(); }

          result.upstream = fallback;
          return getServiceFromUpstream(result.upstream, req.serverassist.partnerId, serviceName, function(err, service) {
            if (err || !service)  { return next(); }    // Try the next option
            return callback(null, result);
          });

        }], function() {
          // Did not find it running. Just use prod
          result.upstream = 'prod';
          return callback(null, result);
        });
      };
    };

    determiness.justX = function(projectName, stack) {
      console.log(`clientStart-determiness-justX ${projectName} ${stack}`)

      determine[projectName] = function(req, res, match, result, callback) {
        result.upstream = stack;
        return callback(null, result);
      };
    };

    /**
     *  Translates simple names (like 'prod') into fqdn for project.
     */
    translate.simple = {};
    translate.simple.v1 = function(req, res, match, result, callback) {
      const requestedStack  = result.upstream || 'prod';
      const query           = stackAlias(requestedStack);
      return stacksDb.find(query).toArray(function(err, stacks) {
        if (err)  { return callback(err); }

        if (!stacks || stacks.length === 0) {
          if (requestedStack !== 'prod') {
            result.upstream = 'prod';
            return translate.simple.v1(req, res, match, result, callback);
          }
          return callback('ENO_STACK');

        } else if (stacks.length > 1) {
          console.error(`Expected only one, got`, stacks, 'qeried:', query, requestedStack);
        }

        result.upstream = stacks[0].fqdn;
        return callback(null);
      });
    };

    translators.onramp = function(projectName) {
      console.log(`clientStart-translators-onramp ${projectName}`)
      setOn(translate, projectName, function(req, res, match, result, callback) {
        return translate.simple.v1(req, res, match, result, function(err) {
          return onrampsDb.find({internalName: result.upstream}).limit(1).next(function(err, onramp) {
            if (err)    { console.error(err); return callback(err); }

            if (onramp) {
              result.upstream = onramp.externalName;
            }

            return callback(err, onramp);
          });
        });
      });
    };

    translators.apigee = function(projectName, version, apiName) {
      translate[projectName] = translate[projectName] || {};
      translate[projectName][version] = function(req, res, match, result, callback) {

        // Get FQDN
        return translate.simple.v1(req, res, match, result, function(err) {
          if (err) { return callback(err); }

          // result.upstream should be fqdn of ours (color-stack.domainname.net)
          var color, stack, domain, tld;
          const m = result.upstream.match(/([^-]+)-([^.]+)\.([^.]+)\.(.*)$/);
          if (m) {
            color   = m[1];
            stack   = m[2]+'.';
            domain  = m[3];
            tld     = m[4];

            if (stack === 'pub.') {
              stack = '';
            }

            result.upstream = `https://${stack}${apiName}.api.hp.com/${projectName}/${color}/api/${version}`;
          }

          return callback(null);
        });
      };
    };


    return next();
  }]);
};

_.each(lib, (v,k) => {
  exports[k] = v;
});


