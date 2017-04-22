var Browser = require('./headless-chrome')

var browser = new Browser({
  executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' // works on osx
})

browser.on('connect', () => {
  browser.navigate('https://www.jcrew.com/womens_category/Swim2.jsp?sidecar=true', err => {
    browser.run(`Array.from(document.querySelectorAll('.plus_product')).map(el => {
  return {
    url: el.querySelector('.plus_image_link').href,
    image: el.querySelector('.plus_image_link img').src,
    title: el.querySelector('.plus_prod_details .desc_line1').textContent,
    price: el.querySelector('.desc_line2').textContent
  }
})`, (err, response) => {
      console.log(JSON.stringify(response.result.value, null, 2))
      browser.close()
    })
  })
})

// this just closes any open browsers if the user presses ctrl-C (SIGINT)
process.on('SIGINT', () => {
  var browsers = Browser.browsers
  for (var port in browsers) {
    browsers[port].close()
  }
  setTimeout(() => {
    process.exit()
  }, 20)
})
