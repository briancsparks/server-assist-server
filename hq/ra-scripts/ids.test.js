
import test       from 'ava';
import Router     from 'routes';
import { getIds
  }               from './ids';

var router  = Router();

// Truth data
var projectId       = 'prj';
var partnerId       = 'PARTNER';
var clientId        = 'asdfclientidaksdfjalsfjalsfj';

// Input data
var body = {
  projectId,
  partnerId,
  clientId
};
var projectRoute    = ["", projectId, "api", "v1"].join('/');

test('ava works', t => {
  t.pass();
});

test('getIds finds project from body', t => {
  var ids = getIds({body}, {});
  t.is(ids.projectId, projectId);
});

test('getIds finds partner from body', t => {
  var ids = getIds({body}, {});
  t.is(ids.partnerId, partnerId);
});

test('getIds finds clientId from body', t => {
  var ids = getIds({body}, {});
  t.is(ids.clientId, clientId);
});

test.cb('getIds finds clientId from body async', t => {
  var ids = getIds({body}, {});

  t.plan(1);

  getIds({body}, {}, function(err, result) {
    t.is(result.clientId, clientId);
    t.end();
  });
});

test('getIds finds project from route', t => {
  router.addRoute('/:projectId/api/:version/*', function(match) {
    return getIds({match}, {});
  });

  var route = router.match(projectRoute+'/clientStart');
  var ids   = route.fn(route);

  t.is(ids.projectId, projectId);
});

