const { should } = require('micro-should');
require('./basic.test.js');
require('./polyval.test.js');
require('./aes.test.js');
require('./ff1.test.js');

if (require.main === module) should.run();
