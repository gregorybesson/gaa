// Test file for GAA extension
function calculateTotal(price, tax) {
    // TODO: Add input validation
    var total = price + tax;
    console.log("Calculating total: " + total);
    return total;
}

function greetUser(name) {
    console.log("Hello " + name + "!");
    return "Hello " + name + "!";
}

module.exports = { calculateTotal, greetUser };