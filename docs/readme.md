
# Currently

To build and run servers and images, you run one of the various build-instance or
run-instance scripts. JS-Cluster is the project that builds the base image (Node.js
and Nginx.) The server-assist-server project is the one that builds out the ServerAssist
style servers.

# JS-Cluster to Build the Base Image

For when you need the changes in the following repos:

* js-cluster
* js-aws
* run-anywhere
* sg

## To build a base image:

The script is `js-cluster/build-scripts/build-instance`.


```
(cd ~/dev/js-cluster/ && ./build-scripts/build-instance --key=mario_demo --service=app --bucket-namespace=mobilewebprint)

--image-id=xenial [default]
--image-id=trusty
--image-id=precise
```

This will build an AMI with the name `serverassist-anystack-NN-base`.

* Don't forget to mark the AMI as `readyFor=pub`

# ServerAssist Adds server-assist Stuff

ServerAssist (server-assist-server) puts server-assist-server and serverassist repos
on the instance, and creates AMI, if desired. For when you change stuff in:

* server-assist-server
* serverassist

## To Build ServerAssist Instances and AMIs

The script is `server-assist-server/build-scripts/build-instance`



Build with the basic options, make an AMI

```
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=teal --service=web --stack=cluster)

--base-name=    [xenial]
--skip-ami      [no]
--no-terminate  [no]
--xvdf=250      [GB size]
```

You probably want to build both the web and netapp instance types:

```
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --stack=cluster --color=teal --service=web) & (cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --stack=cluster --color=teal --service=netapp) & jobs; wait
```


The same script can be used to launch an instance from the current state. (Also uses --skip-ami= and --no-terminate=)

```
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=teal --service=web --stack=test --skip-ami --no-terminate)
```

# JS-Cluster is used again to launch the created AMIs

To run an AMI made above:

* js-cluster/build-scripts/run-instance

```
(cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --stack=test --color=teal)
(cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --key=mario_prod --stack=pub --color=teal)
```

## Or, use sa-server

For one server:
```
(cd ~/dev/server-assist-server/ && ./build-scripts/run-instance --instance-type=t2.large --service=web --stack=test --color=teal)
```

For both servers:
```
(cd ~/dev/server-assist-server/ && ./build-scripts/run-instance --instance-type=t2.large --service=web --stack=test --color=teal) & (cd ~/dev/server-assist-server/ && ./build-scripts/run-instance --instance-type=t2.large --service=netapp --stack=test --color=teal) & jobs; wait
```

## For Mario (non-sa):

* mario_util/admin/buildout/build-servers

```
(cd ~/dev/mario_util/admin/buildout/ && ./build-servers --my-env=development --db=10.10.21.229 --util=10.10.21.4 --teal --services=web)
(cd ~/dev/mario_util/admin/buildout/ && ./build-servers --my-env=development --db=10.10.21.229 --util=10.10.21.4 --teal --image-id=precise --services=rip --full-rip2)
```


# Other things copied-and-pasted

## Launching without creating serverassist ami

```
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web    --stack=cluster --skip-ami --no-terminate) &

(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web    --stack=test    --skip-ami --no-terminate) &
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=netapp --stack=test    --skip-ami --no-terminate) &
jobs; wait

(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web    --stack=pub     --skip-ami --no-terminate) &
(cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=netapp --stack=pub     --skip-ami --no-terminate) &
jobs; wait

```
