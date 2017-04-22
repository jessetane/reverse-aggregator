var Emitter = require('events')
var spawn = require('child_process').spawn
var request = require('simple-get')
var WebSocket = require('ws')
var RPC = require('rpc-engine')

var browsers = {}

function getUniquePort (browser) {
  var port = generateRandomPort()
  while (browsers[port]) {
    port = generateRandomPort()
  }
  browsers[port] = browser
  return port
}

function generateRandomPort () {
  return 9222 + Math.floor(Math.random() * 1000)
}

module.exports = class Browser extends Emitter {
  static get browsers () {
    return browsers
  }

  constructor (opts) {
    super()
    // bound methods
    this.connect = this.connect.bind(this)
    this.onopen = this.onopen.bind(this)
    this.close = this.close.bind(this)
    // public properties
    this.url = opts.url
    this.port = opts.port || getUniquePort(this)
    this.backoff = opts.backoff || 125
    this.connected = false
    // spin up a headless browser
    this.childProcess = spawn(opts.executablePath, [
      '--remote-debugging-port=' + this.port,
      '--headless',
      '--disable-gpu'
    ])
    // attempt to lookup debugger url and connect
    this.connect()
  }

  connect () {
    request.concat(`http://127.0.0.1:${this.port}/json/list`, (err, res, body) => {
      if (this.closed) return
      if (err || res.statusCode !== 200) {
        this.backoff *= 2
        this.connectionTimeout = setTimeout(this.connect, this.backoff)
      } else {
        try {
          this.debuggerUrl = JSON.parse(body)[0].webSocketDebuggerUrl
        } catch (err) {
          this.emit('error', err)
          this.close()
          return
        }
        this.connectWebSocket()
      }
    })
  }

  connectWebSocket () {
    this.socket = new WebSocket(this.debuggerUrl)
    this.socket.once('open', this.onopen)
    this.socket.once('close', this.close)
    this.socket.once('error', err => {
      this.emit('error', err)
      this.close()
    })
  }

  onopen () {
    this.connected = true
    // setup json-rpc over the websocket
    this.rpc = new RPC()
    this.rpc.serialize = JSON.stringify
    this.rpc.deserialize = JSON.parse
    this.rpc.objectMode = true
    this.rpc.timeout = 5000
    this.socket.on('message', this.rpc.onmessage)
    this.rpc.send = this.socket.send.bind(this.socket)
    // enable page notifications
    this.rpc.call('Page.enable', err => {
      if (err) {
        this.emit('error', err)
        this.close()
      } else {
        this.emit('connect')
      }
    })
    // accept and discard any notifications we don't care about
    this.rpc.defaultMethod = message => {
      // console.log(message)
    }
  }

  navigate (url, cb) {
    this.url = url
    this.rpc.methods['Page.frameStoppedLoading'] = () => {
      delete this.rpc.methods['Page.frameStoppedLoading']
      cb()
    }
    this.rpc.call('Page.navigate', { url }, err => {
      if (err) {
        if (cb) {
          cb(err)
        } else {
          this.emit('error', err)
        }
      }
    })
  }

  run (expression, cb) {
    this.rpc.call('Runtime.evaluate', {
      expression,
      returnByValue: true
    }, (err, result) => {
      if (err || result.exceptionDetails) {
        cb(err || new Error(result.exceptionDetails))
      } else {
        cb(null, result)
      }
    })
  }

  runAsync (promiseBody, cb) {
    this.rpc.call('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve, reject) => { ${promiseBody} })`
    }, (err, result) => {
      if (err || result.exceptionDetails) {
        cb(err || new Error(result.exceptionDetails))
      } else {
        cb(null, result)
      }
    })
  }

  close () {
    if (!this.connected || this.closed) return
    this.closed = true
    clearTimeout(this.connectionTimeout)
    delete browsers[this.port]
    this.socket.close()
    this.childProcess.kill()
    this.emit('close')
  }
}
