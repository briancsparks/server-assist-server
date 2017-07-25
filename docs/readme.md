
# Current

To build a base image:

* js-cluster/build-scripts/build-instance
* (cd ~/dev/js-cluster/ && ./build-scripts/build-instance --key=mario_demo --service=app --bucket-namespace=mobilewebprint --image-id=xenial)


To build an instance and make an ami of the servers for ServrerAssist:

* server-assist-server/build-scripts/build-instance
* --base-name=    [xenial]
* --skip-ami      [no]
* --no-terminate  [no]
* --xvdf=
* (cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web --stack=cluster)


The same script can be used to launch an instance from the current state

* (cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web --stack=test --skip-ami --no-terminate)


To run an AMI made above:

* js-cluster/build-scripts/run-instance
* (cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --stack=test --color=blue)
* (cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --key=mario_prod --stack=pub --color=blue)

## For Mario (non-sa):

* mario_util/admin/buildout/build-servers
* (cd ~/dev/mario_util/admin/buildout/ && ./build-servers --my-env=development --db=10.10.21.229 --util=10.10.21.4 --teal --services=web)
* (cd ~/dev/mario_util/admin/buildout/ && ./build-servers --my-env=development --db=10.10.21.229 --util=10.10.21.4 --teal --image-id=precise --services=rip --full-rip2)

