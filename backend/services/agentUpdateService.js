const { Op } = require('sequelize')
const AgentMachine = require('../models/AgentMachine')
const agentHub = require('./agentHub')
const githubService = require('./githubService')

const GITHUB_REPO = 'oculus-pllx/Flux-public'
const CURRENT_VERSION = require('../package.json').version

async function getLatestRelease() {
  const release = await githubService.getLatestRelease(GITHUB_REPO)
  const asset = release.assets.find((a) => /flux-agent.*\.tar\.gz$/.test(a.name))
  if (!asset) throw new Error('No flux-agent tarball asset found in release')
  return { tag: release.tag, version: release.version, assetUrl: asset.browser_download_url }
}

async function checkAndNotify() {
  try {
    const { version, assetUrl } = await getLatestRelease()
    if (version === CURRENT_VERSION) {
      console.log(`[update] Up to date (${CURRENT_VERSION})`)
      return
    }
    console.log(`[update] New version available: ${version}`)
    const agents = await AgentMachine.findAll({
      where: {
        state: { [Op.in]: ['online', 'update-available'] },
        active: true,
      },
    })
    for (const agent of agents) {
      await agent.update({ state: 'update-available', stateDetail: `v${version} available` })
      agentHub.sendToMachine(agent.machineKey, { type: 'update-available', version, assetUrl })
    }
  } catch (err) {
    console.error('[update] checkAndNotify failed:', err.message)
  }
}

async function triggerUpdate(machineId) {
  const machine = await AgentMachine.findByPk(machineId)
  if (!machine) throw Object.assign(new Error('Not found'), { status: 404 })
  const { assetUrl } = await getLatestRelease()
  const sent = agentHub.sendToMachine(machine.machineKey, { type: 'update', assetUrl })
  if (!sent) throw Object.assign(new Error('Agent not connected'), { status: 409 })
  await machine.update({ state: 'updating', stateDetail: 'Update triggered' })
  return { sent: true }
}

module.exports = { getLatestRelease, checkAndNotify, triggerUpdate }
