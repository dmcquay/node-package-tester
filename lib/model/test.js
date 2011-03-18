var mongoose = require('mongoose');

var TestSchema = new mongoose.Schema({
    nodeVersion: String,
    packageName: String,
    packageVersion: String,
    testAttempted: { type: Boolean, default: false },
    testSuccessful: Boolean,
    testStdOut: String,
    testStdErr: String,
    testExitCode: String,
    testExitSignal: String,
    installAttempted: { type: Boolean, default: false },
    installSuccessful: Boolean,
    installStdOut: String,
    installStdErr: String,
    installExitCode: String,
    installExitSignal: String,
    isTestable: Boolean,
});

TestSchema.virtual('uniqueKey').get(function() {
    return [this.nodeVersion, this.packageName, this.packageVersion].join(':');
});

TestSchema.virtual('asString').get(function() {
    return this.packageName + '@' + this.packageVersion + '(node ' + this.nodeVersion + ')';
});

mongoose.model('Test', TestSchema);
