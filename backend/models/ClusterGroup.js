const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const ClusterGroup = sequelize.define('ClusterGroup', {
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  clusterId:      { type: DataTypes.STRING, allowNull: false, unique: true },
  totalVotes:     { type: DataTypes.INTEGER, defaultValue: 0 },
  haFreezePolicy: { type: DataTypes.STRING, defaultValue: 'shutdown_policy=freeze' },
  haFreezeTimeout:{ type: DataTypes.INTEGER, defaultValue: 30 },
})

module.exports = ClusterGroup
