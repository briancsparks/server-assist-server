
# Current

(cd server-assist-server/ && ./build-scripts/build-instance --color=blue --service=web --stack=cluster)
(cd js-cluster/ && ./build-scripts/run-instance --stack=test --color=blue --project-id=sa --service=web --instance-type=t2.large --namespace=serverassist)

