const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const ProxmoxClusterConfig = sequelize.define('ProxmoxClusterConfig', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:            { type: DataTypes.STRING, allowNull: false },
  clusterId:       { type: DataTypes.STRING, allowNull: false },
  apiBaseUrl:      { type: DataTypes.STRING, allowNull: false },
  tokenId:         { type: DataTypes.STRING, allowNull: false },
  tokenSecret:     { type: DataTypes.TEXT, allowNull: true },
  haFreezeTimeout: { type: DataTypes.INTEGER, defaultValue: 30 },
  enabled:         { type: DataTypes.BOOLEAN, defaultValue: true },
})

module.exports = ProxmoxClusterConfig
