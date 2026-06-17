const { exec } = require('child_process')

function executeShutdown(delaySeconds = 60) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const cmd = process.platform === 'win32'
        ? 'shutdown /s /f /t 0'
        : 'shutdown -h now'
      exec(cmd, (err) => {
        if (err) reject(err)
        else resolve()
      })
    }, delaySeconds * 1000)
  })
}

module.exports = { executeShutdown }
