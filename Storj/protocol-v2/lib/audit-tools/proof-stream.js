'use strict';

var assert = require('assert');
var MerkleTree = require('mtree');
var utils = require('../utils');
var inherits = require('util').inherits;
var stream = require('readable-stream');
var crypto = require('crypto');

/**
 * Provides interface for proving possession of a file for an
 * {@link AuditStream}
 * @constructor
 * @license LGPL-3.0
 * @param {Array} merkleLeaves - Bottom leaves of the audit merkle tree
 * @param {String} hexChallenge - The challenge data in hex to prepend to shard
 */
function ProofStream(leaves, challenge) {
  if (!(this instanceof ProofStream)) {
    return new ProofStream(leaves, challenge);
  }

  assert(Array.isArray(leaves), 'Merkle leaves must be an array');
  assert.ok(challenge, 'Invalid challenge supplied');

  this._tree = new MerkleTree(this._generateLeaves(leaves),
                              utils.rmd160sha256b);
  if (!Buffer.isBuffer(challenge)) {
    this._challenge = Buffer.from(challenge, 'hex');
  } else {
    this._challenge = challenge;
  }
  this._hasher = crypto.createHash('sha256').update(this._challenge);
  this._proof = null;

  stream.Transform.call(this, { objectMode: true });
}

inherits(ProofStream, stream.Transform);

/**
 * Returns the generated proof structure
 * @return {Array}
 */
ProofStream.prototype.getProofResult = function() {
  assert(Array.isArray(this._proof), 'Proof generation is not complete');

  return this._proof;
};

/**
 * Handles writing the shard data to the proof stream
 * @private
 */
ProofStream.prototype._transform = function(chunk, encoding, next) {
  this._hasher.update(chunk, encoding);
  next();
};

/**
 * Generates the proof from the read data
 * @private
 */
ProofStream.prototype._flush = function(done) {
  try {
    this._generateProof();
  } catch (err) {
    return done(err);
  }

  this.push(this.getProofResult());
  done();
};

ProofStream.prototype._findMatchIndex = function(leaves, leaf) {
  var challengenum = -1;
  for (let i = 0; i < leaves.length; i++) {
    if (Buffer.compare(leaves[i], leaf) === 0) {
      challengenum = i;
      break;
    }
  }
  return challengenum;
}

/**
 * Calculate audit response
 * @private
 * @param {String} challenge - Challenge string sent by auditor
 * @returns {Array} result - Challenge response
 */
ProofStream.prototype._generateProof = function() {

  var response = utils.rmd160b(this._hasher.digest());
  var leaves = this._tree.level(this._tree.levels() - 1);

  const leaf = utils.rmd160sha256b(response);

  var challengenum = this._findMatchIndex(leaves, leaf);

  assert(challengenum !== -1, 'Failed to generate proof');

  var branches = [response];

  for (var i = (this._tree.levels() - 1); i > 0; i--) {
    var level = this._tree.level(i);

    if (challengenum % 2 === 0) {
      branches = [branches, level[challengenum + 1]];
    } else {
      branches = [level[challengenum - 1], branches];
    }

    challengenum = Math.floor(challengenum / 2);
  }

  this._proof = branches;
};

/**
 * Generates the bottom leaves of the tree to the next power of two
 * @private
 * @param {Array} leaves
 */
ProofStream.prototype._generateLeaves = function(leaves) {
  var numEmpty = utils.getNextPowerOfTwo(leaves.length) - leaves.length;
  var emptyLeaves = [];

  for (var i = 0; i < numEmpty; i++) {
    emptyLeaves.push(utils.rmd160sha256b(''));
  }

  leaves = leaves.map((i) => Buffer.from(i, 'hex'))

  return leaves.concat(emptyLeaves);
};

module.exports = ProofStream;
