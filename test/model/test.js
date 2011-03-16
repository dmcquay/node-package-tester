var mongoose = require('mongoose');
require('../../lib/model/test');
mongoose.connect('mongodb://localhost/npt');
var Test = mongoose.model('Test');
var test1 = new Test();
test1.nodeVersion = '0.4.1';
test1.packageName = 'gracie';
test1.packageVersion = '0.2.1';
test1.save(function(err) {
    console.log('save completed');
    if (err) console.log('there was an error: ' + err);
    mongoose.connection.close();
});
console.log(test1.uniqueKey);
