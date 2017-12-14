var Bitcore = require('bitcore-lib-dash');
Bitcore.Networks.defaultNetwork = Bitcore.Networks.testnet; // default to testnet
var Transaction = Bitcore.Transaction;
var HDPrivateKey = Bitcore.HDPrivateKey;

var PaymentProtocol = require('bitcore-payment-protocol-dash');
var fs = require('fs');

var now = Date.now() / 1000 | 0;

var address = Bitcore.Address.fromString('yRGudxDCcqtWqqGLtyXYeTdUqg8Lepex7p'); // payment destination address
var script = Bitcore.Script.buildPublicKeyHashOut(address);

var output = new PaymentProtocol.Output();
output.set('amount', 100000); // amount in duffs
output.set('script', script.toBuffer()); // an instance of script

var merchant_data = new Buffer(JSON.toString({size: 7})); // internal info for merchant integration

// construct the payment details
var details = new PaymentProtocol().makePaymentDetails();
details.set('network', 'live');
details.set('outputs', output);
details.set('time', now);
details.set('expires', now + 60 * 60 * 24);
details.set('memo', 'A payment request from the merchant.');
details.set('payment_url', 'https://localhost/-/pay');
details.set('merchant_data', merchant_data); // identify the request

// load the X509 certificate
var certificates = new PaymentProtocol().makeX509Certificates();
certificates.set('certificate', fs.readFileSync('./cert.der')); // self-signed cert (https://stackoverflow.com/questions/16480846/x-509-private-public-key)

// form the request
var request = new PaymentProtocol().makePaymentRequest();
request.set('payment_details_version', 1);
request.set('pki_type', 'x509+sha256');
request.set('pki_data', certificates.serialize());
request.set('serialized_payment_details', details.serialize());
request.sign(fs.readFileSync('./private.key')); // sign with corresponding private key

// serialize the request
var rawbody = request.serialize();

console.log('- merchant sends payment request -');
console.log(request);

// verify payment request

var body = PaymentProtocol.PaymentRequest.decode(rawbody);
var request = new PaymentProtocol().makePaymentRequest(body);

var version = request.get('payment_details_version');
var pki_type = request.get('pki_type');
var pki_data = request.get('pki_data');
var serializedDetails = request.get('serialized_payment_details');
var signature = request.get('signature');

// Verify the signature
var verified = request.verify();

if (verified) {
    console.log('');
    console.log('- client verifies signature - ');
}

// Get the payment details
var decodedDetails = PaymentProtocol.PaymentDetails.decode(serializedDetails);
var details = new PaymentProtocol().makePaymentDetails(decodedDetails);
var network = details.get('network');
var outputs = details.get('outputs');
var time = details.get('time');
var expires = details.get('expires');
var memo = details.get('memo');
var payment_url = details.get('payment_url');
var merchant_data = details.get('merchant_data');

// testnet wallet
var WIF = '74707276385a67784d426963514b735064314376335453626d32476233375964516657504b46326f6b63384a76697a327a356f6865467948335a576937436d39624d48463553624155716b4e374c7032776b724b7263763257446d73744679485276677552554a6d37327a65647654';
var hdPrivateKey = new HDPrivateKey(new Buffer(WIF, 'hex'));

var derivedChange = hdPrivateKey.derive("m/1'");
var changeAddress = derivedChange.privateKey.toAddress();

// https://testnet-insight.dashevo.org/insight-api-dash/addr/yM9TNxUo9xMPvPPxXLde9ZjxHFG9JYzagS/utxo
var utxo = new Bitcore.Transaction.UnspentOutput({
    "txid" : "5610033240397e0ed0c4cf1c73a75f32cfbee24052948a5097ed6bc84dc02c8b",
    "vout" : 0,
    "address" : "yM9TNxUo9xMPvPPxXLde9ZjxHFG9JYzagS",
    "scriptPubKey" : "76a914091468a6af27205c252546370b457884e63419d388ac",
    "satoshis" : 90953360000
});

// create transaction using the Outputs

var scriptBuffer = outputs[0].script.buffer.slice(outputs[0].script.offset, outputs[0].script.limit); // somewhat messy...
var script = Bitcore.Script.fromBuffer(scriptBuffer);
var address = script.toAddress(); // payment address
var amount = outputs[0].amount.low; // payment amount

var transaction = new Transaction()
    .from(utxo)          // Feed information about what unspent outputs one can use
    .to(address, amount)  // Add an output with the given amount of satoshis
    .change(changeAddress)      // Sets up a change address where the rest of the funds will go
    .sign(derivedChange.privateKey);     // Signs all the inputs it can

// send the payment transaction
var payment = new PaymentProtocol().makePayment();
payment.set('merchant_data', merchant_data);
payment.set('transactions', transaction.toBuffer()); // as from payment details

// define the refund outputs
var refund_outputs = [];
var outputs = new PaymentProtocol().makeOutput();
outputs.set('amount', 0);
outputs.set('script', script.toBuffer()); // an instance of script (optional)
refund_outputs.push(outputs.message);

payment.set('refund_to', refund_outputs);
payment.set('memo', 'Here is a payment');

// serialize and send
var rawbody = payment.serialize();

console.log('');
console.log('- customer sends payment - ');
console.log(payment);

// merchant receives payment

var body = PaymentProtocol.Payment.decode(rawbody);
var payment = new PaymentProtocol().makePayment(body);
var merchant_data = payment.get('merchant_data');
var transactions = payment.get('transactions');
var refund_to = payment.get('refund_to');
var memo = payment.get('memo');

var testBuffer = transactions[0].buffer.slice(transactions[0].offset);

var newTransaction = Bitcore.Transaction(testBuffer);

var newTransactionObj = newTransaction.toObject();

console.log('');
console.log('- merchant checks transaction output -');
console.log(newTransactionObj);

var newScript = Bitcore.Script(newTransactionObj.outputs[0].script);


// assuming amount and address match, send acknowledgement

// make a payment acknowledgement
var ack = new PaymentProtocol().makePaymentACK();
ack.set('payment', payment.message);
ack.set('memo', 'Thank you for your payment!');
var rawbody = ack.serialize();

console.log('');
console.log('- merchant sends payment awknowledgement -');
console.log(ack);

// client parses acknowledgement

var body = PaymentProtocol.PaymentACK.decode(rawbody);
var ack = new PaymentProtocol().makePaymentACK(body);
var serializedPayment = ack.get('payment');
var memo = ack.get('memo');
var decodedPayment = PaymentProtocol.Payment.decode(serializedPayment);
var payment = new PaymentProtocol().makePayment(decodedPayment);
var tx = payment.message.transactions[0];
