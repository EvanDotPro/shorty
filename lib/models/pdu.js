/**
 * This file is part of Shorty.
 *
 * Shorty is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; version 3 of the License.
 *
 * Shorty is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Shorty.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @category   shorty
 * @license    http://www.gnu.org/licenses/gpl-3.0.txt GPL
 * @copyright  Copyright 2010 Evan Coury (http://www.Evan.pro/)
 * @package    models
 */

var smpp    = require('./../smpp'),
    sys     = require('sys');

var pdu = function(command_id, sequence_number, pdu_body, command_status) {
    var self = this;
    self.command_id = command_id;
    self.sequence_number = sequence_number;
    if (pdu_body instanceof Buffer) {
        self.pdu_body = pdu_body;
    } else {
        if (pdu_body == undefined) {
            pdu_body = "";
        }
        self.pdu_body = exports.createBuffer(pdu_body);
    }

    if (command_status == undefined) {
        self.command_status = 0;
    } else {
        self.command_status = command_status;
    }

    self.toBuffer = function() {
        // headers should only be created when it's time to turn into a buffer
        // just in case body data changes in the mean time
        var headerBuffer = self.getHeader();
        var wholeBuffer = new Buffer(headerBuffer.length + self.pdu_body.length);
        headerBuffer.copy(wholeBuffer, 0, 0);
        self.pdu_body.copy(wholeBuffer, headerBuffer.length, 0);
        return wholeBuffer;
        //return exports.createBuffer(self.header + self.pdu_body);
    };

    self.getHeader = function() {
        return exports.createBuffer(exports.pack('NNNN', self.pdu_body.length + 16, self.command_id, self.command_status, self.sequence_number));
    }
};

/**
 *  WARNING: you must take EXTREME care when editing ANYTHING in this method.
 *  There are fixes for Nagle's algorithm and for TCP packet splitting that are
 *  very easy to break (and were very difficult to fix)
 *
 *  After editing, the best way to determine whether your changes were safe is to
 *  run a shorty server and client on localhost, and have the client attempt to send
 *  about 5k messages to the server. If the client receives responses for all messages,
 *  then you're good. Otherwise, your changes will NOT be production-safe.
 */
exports.fromBuffer = function(pduBuffer, splitBuffer) {
    var pdus = [];

    // If splitBuffer is set, that means there were tcp packet-splitting shenanigans going on
    // at the end of our last data buffer, and we need to prepend this data to the splitBuffer
    // to pduBuffer in order to get good data
    if (splitBuffer instanceof Buffer && splitBuffer.length > 0) {
        tempPduBuffer = new Buffer(pduBuffer.length);
        pduBuffer.copy(tempPduBuffer, 0, 0);

        pduBuffer = new Buffer(tempPduBuffer.length + splitBuffer.length);
        splitBuffer.copy(pduBuffer, 0, 0);
        tempPduBuffer.copy(pduBuffer, splitBuffer.length, 0);
    }

    if (pduBuffer.length < 16) {
        return false;
    }

    var bufferPosition = 0;

    // While there are still potential SMPP PDUs inside the buffer
    while (bufferPosition <= (pduBuffer.length - 16)) {

        // Parse the length from the PDU
        var length = (pduBuffer[bufferPosition + 0] << 24) +
                 (pduBuffer[bufferPosition + 1] << 16) +
                 (pduBuffer[bufferPosition + 2] << 8) +
                 (pduBuffer[bufferPosition + 3]);

        // not breaking under these conditions will cause an error!
        if ((length < 16 || ((bufferPosition + length) > pduBuffer.length)) && (bufferPosition <= pduBuffer.length)) {
            break;
        }

        var myPdu = exports.individualPduFromBuffer(pduBuffer.slice(bufferPosition, bufferPosition + length));
        if (myPdu) {
            pdus.push(myPdu);
        }

        bufferPosition += (length);
    }

    // here is the fix for the splitBuffer breaking (took about 2 days to figure this out)
    if (pduBuffer.length > bufferPosition) {
        var splitPacketBuffer = pduBuffer.slice(bufferPosition, pduBuffer.length);
    } else {
        var splitPacketBuffer = new Buffer(0);
    }

    return {pdus: pdus, splitPacketBuffer: splitPacketBuffer};

};

exports.individualPduFromBuffer = function(pduBuffer) {
    if (pduBuffer.length < 16) {
        return false;
    }

    var length = (pduBuffer[0] << 24) +
             (pduBuffer[1] << 16) +
             (pduBuffer[2] << 8) +
             (pduBuffer[3]);
    var command_id = ((pduBuffer[4] << 24) +
              (pduBuffer[5] << 16) +
              (pduBuffer[6] << 8) +
              (pduBuffer[7]) >>> 0);
    var command_status = (pduBuffer[8] << 24) +
              (pduBuffer[9] << 16) +
              (pduBuffer[10] << 8) +
              (pduBuffer[11]);
    var sequence_number = (pduBuffer[12] << 24) +
              (pduBuffer[13] << 16) +
              (pduBuffer[14] << 8) +
              (pduBuffer[15]);

    if (smpp.command_ids[command_id] == undefined) {
        return false;
    }

    if ((length - 16) > 0) {
        var pdu_body = pduBuffer.slice(16, length);
    } else {
        var pdu_body = undefined;
    }

    return new pdu(command_id, sequence_number, pdu_body, command_status);
};

/**
 * This is just for convenience.
 */
exports.createPdu = function(command_id, sequence_number, pdu_body, command_status) {
    return new pdu(command_id, sequence_number, pdu_body, command_status);
};

exports.createBuffer = function(str) {
    var buf = new Buffer(str.length);
    for (var i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i);
    }
    return buf;
};

exports.pack = function(format) {
    var packed = '';
    var argi = 1;
    for (i = 0; i < format.length; i++) {
        var chr = format.charAt(i);
        var arg = arguments[argi];
        var num = '';
        switch (chr) {
            case 'A':
                num = '';
                while (format.charAt(i+1).match(/^\d$/)){
                    num = num + format.charAt(i+1);
                    i++;
                }
                if (num.length == 0) {
                    num = 1;
                }
                num = parseInt(num);
                for (j = 0; j <= num; j++) {
                    var chrj = arg.charAt(j);
                    if (j > arg.length) {
                        packed += ' ';
                    } else {
                        packed += chrj;
                    }
                }
                argi++;
                break;
            case 'a':
                num = '';
                while (format.charAt(i+1).match(/^\d$/)) {
                    num = num + format.charAt(i+1);
                    i++;
                }
                if (num.length == 0) {
                    num = 1;
                }
                num = parseInt(num);
                for (j = 0; j <= num; j++) {
                    var chrj = arg.charAt(j);
                    if (j > arg.length) {
                        packed += "\0";
                    } else {
                        packed += chrj;
                    }
                }
                argi++;
                break;
            case 'C':
            case 'c':
                num = '';
                while (format.charAt(i+1).match(/^\d$/)) {
                    num = num + format.charAt(i+1);
                    i++;
                }
                if (num.length == 0) {
                    num = 1;
                }
                num = parseInt(num);
                for (j = 1; j <= num; j++) {
                    packed += String.fromCharCode(arg);
                    argi++;
                    var arg = arguments[argi];
                }
                break;
            case 'N':
                num = '';
                while (format.charAt(i+1).match(/^\d$/)) {
                    num = num + format.charAt(i+1);
                    i++;
                }
                if (num.length == 0) {
                    num = 1;
                }
                num = parseInt(num);
                for (j = 1; j <= num; j++) {
                    packed += String.fromCharCode((arg >> 24) & 255, (arg >> 16) & 255, (arg >> 8) & 255, arg & 255);
                    argi++;
                    var arg = arguments[argi];
                }
                break;
        }
    }
    return packed;
};
