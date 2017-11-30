
/**
 *
 */
const sg                      = require('sgsg');
const _                       = sg._;

const deref                   = sg.deref;
const setOnn                  = sg.setOnn;

var lib = {};

/**
 *  Sets various things, based on the cluster configuration.
 */
const reconfigure = lib.reconfigure = function(modName, r_, projects, projectRunningStates) {

  console.log(`${modName} reconfiguring`);

  var   projectByDomainName_, appBySubdomain_, xapiPrefixes_, app_prjs_, knownProjectIds_ = {};

  const r = r_;

  // Remember the 'sa' project (so we can associate it with mobilewebassist.net)
  var   saProject;

  // Which projects (by db record) are associated with which domain names?
  projectByDomainName_ = sg.reduce(r.db.projectRecords, {}, (m, project) => {
    if (project.projectId === 'sa')   { saProject = project; }
    if (project.uriBase)              { m = sg.kv(m, project.uriBase.split('/')[0], project); }
    if (project.uriTestBase)          { m = sg.kv(m, project.uriTestBase.split('/')[0], project); }

    knownProjectIds_ = sg.kv(knownProjectIds_, project.projectId, {});

    projects[project.projectId] = project;
    return m;
  });
  projectByDomainName_['mobilewebassist.net'] = saProject;
  projectByDomainName_['mobiledevassist.net'] = saProject;

  // Which apps (by db record) are associated with what subdomains?
  appBySubdomain_ = sg.reduce(r.db.appRecords, {}, (m, app) => {
    if (app.subdomain) { return sg.kv(m, app.subdomain.split('.')[0], app); }
    return m;
  });

  // Get the prefixes for xapi (like telemetry, attrstream, s3)
  xapiPrefixes_ = sg.reduce(r.db.appRecords, [], (m, app) => {
    return sg.ap(m, deref(app, ['xapiPrefix']));
  });

  app_prjs_ = sg.reduce(r.db.appprjRecords, {}, (m, appprj) => {
    knownProjectIds_ = sg.kv(knownProjectIds_, appprj.projectId, appprj);

    return sg.kv(m, appprj.appProjectId, appprj);
  });

  // ------------------------------------------------------------------------
  //  Find the running state for each stack type. I.e. "In the test stack,
  //  which instances/colors are main, next, etc?
  //
  //   ntl:
  //    { pub:
  //       { prev:
  //          { projectServicePrefix: 'netlab',
  //            color: 'green',
  //            projectId: 'ntl',
  //            stack: 'pub',
  //            state: 'prev',
  //            fqdn: 'green-pub.mobilewebassist.net',
  //            account: 'pub',
  //            baseProjectServicePrefix: 'serverassist' },
  //         main:
  //          { projectServicePrefix: 'netlab',
  //            color: 'blue',
  //            projectId: 'ntl',
  //            stack: 'pub',
  //            state: 'main',
  //            fqdn: 'blue-pub.mobilewebassist.net',
  //            account: 'pub',
  //            baseProjectServicePrefix: 'serverassist' } },
  //      cluster:
  //       { main: }}
  //

  // Find the state of the instances (which colors are main, for example)
  _.each(r.db.instanceRecords, (instance) => {
    const project = r.db.projectRecords[instance.projectId] || {};

    if (instance.state in {main:true, next:true, prev:true}) {                            /* other states like 'gone' are meaningless here */
      const projectServicePrefix  = project.serviceName || project.projectName || 'psn';
      const runningState          = sg._extend({projectServicePrefix}, instance);

      setOnn(projectRunningStates, [instance.projectId, instance.stack, instance.state], runningState);
    }
  });

  // Some projects have 'sa' as a base project; setup their running state
  _.each(r.db.projectRecords, (project) => {
    if (!project.base || !projectRunningStates[project.base]) { return; }

    // Only set it if we do not alreay have it
    if (!projectRunningStates[project.projectId]) {
      const projectServicePrefix  = project.serviceName || project.commonName || project.projectName || 'psn';

      setOnn(projectRunningStates, project.projectId, sg.deepCopy(deref(projectRunningStates, project.base)));

      // Fixup entries
      _.each(deref(projectRunningStates, project.projectId), (runningStack, runningStackName) => {
        _.each(runningStack, (runningState, runningStateName) => {
          const baseProjectServicePrefix = deref(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectServicePrefix']);

          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'baseProjectServicePrefix'],   baseProjectServicePrefix);
          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectServicePrefix'],       projectServicePrefix);
          setOnn(projectRunningStates, [project.projectId, runningStackName, runningStateName, 'projectId'],                  project.projectId);
        });
      });
    }
  });
  //console.log('-------------------------------', util.inspect(projectRunningStates, {depth:null, colors:true}));

  // Some app_prjs have 'sa' as a base project; setup their running state
  _.each(r.db.appprjRecords, (appprj) => {

    // Only set it if we do not alreay have it
    if (projectRunningStates[appprj.projectId]) { return; }

    const projectServicePrefix  = appprj.serviceNamespace;

    setOnn(projectRunningStates, appprj.projectId, sg.deepCopy(deref(projectRunningStates, 'sa')));

    // Fixup entries
    _.each(deref(projectRunningStates, appprj.projectId), (runningStack, runningStackName) => {
      _.each(runningStack, (runningState, runningStateName) => {
        const baseProjectServicePrefix = deref(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectServicePrefix']);

        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'baseProjectServicePrefix'],   baseProjectServicePrefix);
        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectServicePrefix'],       projectServicePrefix);
        setOnn(projectRunningStates, [appprj.projectId, runningStackName, runningStateName, 'projectId'],                  appprj.projectId);
      });
    });
  });
  //console.log('-------------------------------', util.inspect(projectRunningStates, {depth:null, colors:true}));

  // Update the global vars all at once
  const knownProjectIds     = knownProjectIds_;
  const projectByDomainName = projectByDomainName_;
  const appBySubdomain      = appBySubdomain_;
  const xapiPrefixes        = xapiPrefixes_;
  const app_prjs            = app_prjs_;
  const serviceFinders      = {};

  return {
    knownProjectIds,
    projectByDomainName,
    appBySubdomain,
    xapiPrefixes,
    app_prjs,
    serviceFinders
  };
};











_.each(lib, function(value, key) {
  exports[key] = value;
});


