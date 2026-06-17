const { Sequelize } = require('sequelize')
const path = require('path')
const fs = require('fs')

const dbPath = process.env.DB_PATH || './data/flux.db'
const resolvedDbPath = dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath)
if (resolvedDbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true })
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: resolvedDbPath,
  logging: false,
})

async function initDatabase() {
  await sequelize.authenticate()
  // alter: { drop: false } adds new columns in all environments without ever
  // dropping columns — safe for production schema evolution (Sequelize 6.14+).
  await sequelize.sync({ alter: { drop: false } })
  console.log('Database initialized')
}

module.exports = { sequelize, initDatabase }
