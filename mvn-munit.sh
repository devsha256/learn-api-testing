#!/bin/bash
# mvn-munit.sh
# Argument $1 = project folder name

ROOT="C:/VistrCorp/AzureRepos"
PROJECT=$1

cd "$ROOT/$PROJECT" || exit 1

git reset --hard
git checkout dev
git pull origin dev

mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report \
    -Dsecurekey=pass@2025 \
    -Denv=dev \
    --no-transfer-progress
