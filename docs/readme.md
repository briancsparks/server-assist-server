
# Current

# JS-Cluster to build the base image (the one with Node.js and nginx)

## To build a base image:

* js-cluster/build-scripts/build-instance


```
    (cd ~/dev/js-cluster/ && ./build-scripts/build-instance --key=mario_demo --service=app --bucket-namespace=mobilewebprint --image-id=xenial)
```


# ServerAssist (server-assist-server) puts our repos on the instance, and creates AMI, if desired

## To build an instance and make an ami of the servers for ServrerAssist:

* server-assist-server/build-scripts/build-instance
* --base-name=    [xenial]
* --skip-ami      [no]
* --no-terminate  [no]
* --xvdf=


Build with the basic options, make an AMI

```
    (cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web --stack=cluster)
```


The same script can be used to launch an instance from the current state. (Also uses --skip-ami= and --no-terminate=)

```
    (cd ~/dev/server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web --stack=test --skip-ami --no-terminate)
```

# JS-Cluster is used again to launch the created AMIs

To run an AMI made above:

* js-cluster/build-scripts/run-instance

```
    (cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --stack=test --color=blue)
    (cd ~/dev/js-cluster/ && ./build-scripts/run-instance --project-id=sa --instance-type=t2.large --namespace=serverassist --service=web --key=mario_prod --stack=pub --color=blue)
```

## Or, use sa-server

```
    (cd ~/dev/server-assist-server/ && ./build-scripts/run-instance --instance-type=t2.large --service=web --stack=test --color=blue)
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

