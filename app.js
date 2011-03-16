var exec = require('child_process').exec,
    step = require('step'),
    mongoose = require('mongoose');

require('./lib/model/test');
mongoose.connect('mongodb://localhost/npt');
var Test = mongoose.model('Test');

function getNodeVersions(callback) {
    exec("./list-installed-node-versions", function(err, stdout, stderr) {
        var versions;
        if (err) return callback(err);
        versions = stdout.split(/\s/);
        versions.splice(versions.length - 1, 1); //not sure why unshift doesn't do this
        return callback(null, versions);
    });
}

function getAllPackages(callback) {
    exec("./list-all-packages", function(err, stdout, stderr) {
        if (err) return callback(err);
        var i, tmp, lines, packageName, packageVersion, packageMap = {}, packageArray = [];

        //parse the package data
        lines = stdout.split(/\s/);
        for (i = 0; i < lines.length; i++) {
            tmp = lines[i].split('@')
            packageName = tmp[0];
            packageVersion = tmp[1];
            if (typeof(packageMap[packageName]) == 'undefined') {
                packageMap[packageName] = { name: packageName, versions: [packageVersion] };
            } else {
                packageMap[packageName].versions.push(packageVersion);
            }
        }

        //restructure into an array for callback
        for (packageName in packageMap) {
            packageArray.push(packageMap[packageName]);
        }
        callback(null, packageArray);
    });
}

function buildFullTestList(callback) {
    getNodeVersions(function(err, nodeVersions) {
        getAllPackages(function(err, packages) {
            if (err) return callback(err);
            var i, c, x, test, tests = [];
            for (i = 0; i < nodeVersions.length; i++) {
                for (c = 0; c < packages.length; c++) {
                    for (x = 0; x < packages[c].versions.length; x++) {
                        test = new Test();
                        test.nodeVersion = nodeVersions[i];
                        test.packageName = packages[c].name;
                        test.packageVersion = packages[c].versions[x];
                        tests.push(test);
                    }
                }
            }
            callback(null, tests);
        });
    });
}

function getPersistedTestsByUniqueKey(callback) {
    Test.find({}, function(err, tests) {
        var i, test, testsByKey = {};
        if (err) return callback(err);
        for (i = 0; i < tests.length; i++) {
            test = tests[i];
            testsByKey[test.uniqueKey] = test;
        }
        callback(null, testsByKey);
    });
}

function addMissingTests(callback) {
    buildFullTestList(function(err, allTests) {
        getPersistedTestsByUniqueKey(function (err, testsByKey) {
            var i, testsToSave = [], testsSaved = 0, postSaveCallback;
            for (i = 0; i < allTests.length; i++) {
                if (!testsByKey[allTests[i].uniqueKey]) {
                    testsByKey[allTests[i].uniqueKey] = allTests[i];
                    testsToSave.push(allTests[i]);
                }
            }

            if (testsToSave.length) {
                step(
                    function() {
                        for (i = 0; i < testsToSave.length; i++) {
                            testsToSave[i].save(this.parallel());
                        }
                    },
                    function(err, tests) {
                        if (err) return callback(err);
                        callback(null, testsToSave);
                    }
                )
            } else {
                callback(null, testsToSave);
            }
        });
    });
}

function findTestsToRun(callback) {
    Test.find({installAttempted:false, testAttempted:false}).execFind(callback);
    //Test.find({packageName:'seq', packageVersion:'0.0.8', nodeVersion:'0.4.2'}).limit(100).execFind(callback); //fails to install
    //Test.find({packageName:'sfml', packageVersion:'0.0.1', nodeVersion:'0.4.2'}).limit(100).execFind(callback); //prompts for sudo password
    //Test.find({packageName:'abbrev', packageVersion:'1.0.2', nodeVersion:'0.4.1'}).limit(100).execFind(callback); //test causes fatal error
    //Test.find({packageName:'ams', packageVersion:'0.0.1', nodeVersion:'0.4.1'}).limit(100).execFind(callback); //test causes fatal error
    //FAILED: ./install-package actor 0.0.2 0.4.1
    //FAILED: ./install-package ace 0.1.1 0.4.1
    //FAILED: ./install-package ace 0.1.6 0.4.1
    //FAILED: ./test-package addressable 0.2.0 0.4.1
};

function installPackageForTest(test, callback) {
    var command, child, childExited, timeoutSeconds;
    timeoutSeconds = 20;
    childExited = false;
    command = [
        "./install-package",
        test.packageName,
        test.packageVersion,
        test.nodeVersion
    ].join(' ');
    console.log('STARTING: ' + command);
    child = exec(
        command,
        { timeout: timeoutSeconds * 1000 },
        function(err, stdout, stderr) {
            console.log((err ? 'FAILED: ' : 'FINISHED: ') + command);
            childExited = true;
            test.installAttempted = true;
            test.installStdOut = stdout;
            test.installStdErr = stderr;
            test.installSuccessful = !Boolean(err);
            if (err && err.code) test.installExitCode = err.code;
            if (err && err.signal) test.installExitSignal = err.signal;
            test.save(function(err2) {
                callback(err || err2);
            });
        }
    );
}

function executeTest(test, callback) {
    var command, child, childExited, timeoutSeconds;
    timeoutSeconds = 20;
    childExited = false;
    command = [
        "./test-package",
        test.packageName,
        test.packageVersion,
        test.nodeVersion
    ].join(' ');
    console.log('STARTING: ' + command);
    child = exec(
        command,
        { timeout: timeoutSeconds * 1000 },
        function(err, stdout, stderr) {
            console.log((err ? 'FAILED: ' : 'FINISHED: ') + command);
            childExited = true;
            test.testAttempted = true;
            test.testSuccessful = !Boolean(err);
            test.testStdOut = stdout;
            test.testStdErr = stderr;
            if (err && err.code) test.installExitCode = err.code;
            if (err && err.signal) test.installExitSignal = err.signal;
            test.save(callback);
        }
    );
}

function runTest(test, callback) {
    step(
        function() {
            installPackageForTest(test, this);
        },
        function(err) {
            if (err) return null;
            executeTest(test, this);
        },
        callback
    );
}

function runMultipleTests(tests, callback) {
    if (tests.length === 0) return callback();
    var maxConcurrency = 6,
        numTestsToExecute = Math.min(tests.length, maxConcurrency),
        testsToExecute = tests.splice(0, numTestsToExecute);
    step(
        function() {
            for(var i = 0; i < testsToExecute.length; i++) {
                runTest(testsToExecute[i], this.parallel());
            }
        },
        function(err, results) {
            if (err) return callback(err);

            if (tests.length > 0) {
                console.log('finished a batch of tests. executing another...');
                runMultipleTests(tests, callback);
            } else {
                console.log('finished all test batches');
                callback();
            }
        }
    );
}

function main() {
    step(
        function () {
            console.log('adding missing tests...');
            addMissingTests(this);
        },
        function (err, addedTests) {
            console.log('added ' + addedTests.length + ' tests');
            console.log('finding tests to run...');
            findTestsToRun(this);
        },
        function (err, testsToRun) {
            console.log('found ' + testsToRun.length + ' tests to be run');
            console.log('executing tests...');
            runMultipleTests(testsToRun, this);
        },
        function(err) {
            console.log('done');
            mongoose.connection.close();
        }
    );
}

main();
