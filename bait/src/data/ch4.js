/* BAIT — CHAPTER 4: DRIFT.
 *
 * AUTHOR: Lathe. Briefs and arc are Atlas's, in the header of chapters.js.
 * Nobody else edits this file.
 *
 * The chapter's one idea: you no longer fully own your heading. Conveyors add
 * drift, deflectors slam it, rotors deny ground on a rhythm.
 *
 * NUMBERS THIS CHAPTER IS BUILT ON, all read out of pieces.js/sim.js rather
 * than assumed, because every room below is timed against them:
 *   SPEED         2 px/tick   (a 40px cell takes 20 ticks to cross)
 *   CONVEY_SPEED  1 px/tick   (exactly half, so walking INTO a belt still
 *                              nets 1 px/tick — slow, but never a trap)
 *   rotor beat    period * 10 ticks, orientation = (beat + phase) & 3
 *                 indexed [N, E, S, W]. So period 8 = 80 ticks per quarter.
 *   rotor hub     SOLID. It blocks movement and absorbs bullets, which 4-12
 *                 is built on entirely.
 *   rotor arms    axis-aligned only, so the cells DIAGONAL from a hub are
 *                 never swept. That is the safe ground 4-05 is about.
 *
 * par is null. Sieve's solver computes it. Never hand-tune it.
 */
(function (BAIT) {
  'use strict';

  /* Boss's file pattern names addRooms(); chapters.js on disk exports the
   * same thing as attach(). Bind whichever is present so this file does not
   * care which name Atlas lands on. */
  var C = BAIT.Chapters;
  var R = C.R;
  var addRooms = C.addRooms || C.attach;

  var CH4 = [

    /* 4-01. The belt is the only way east and the only way back, so the room
     * states both halves of the mechanic and then makes you use both. Riding
     * east is 3 px/tick, fighting west is 1 px/tick. Nothing here can kill
     * you: this is the chapter's handshake, the way 1-02 was chapter one's.
     * The token shaft pushes SOUTH, so the detour is a climb at 1 px/tick and
     * the ride back down is free. Pure time cost, no risk, which is all a
     * room with no hazards in it can honestly charge. */
    R('4-01', 'SLIPSTREAM',
      'Drift adds to your velocity, and it adds to it both ways.',
      'The ride east is free. The walk back is the same belt, and it is slow.',
      ['####################',
       '####################',
       '####################',
       '#########o##########',
       '#########!##########',
       '#########!##########',
       '#########!##########',
       '#########!##########',
       '#....CCCC.CCCCC....#',
       '#S...CCCC.CCCCC...k#',
       '#E...CCCC.CCCCC....#',
       '####################',
       '####################',
       '####################']),

    /* 4-02. A band of SOUTH belts is the only crossing, with a pit under it.
     * Crossing 6 cells takes 140 ticks and sinks you 3.5 cells, so an entry
     * at row 2 lands at row 5 and the exit is put exactly there. Hesitating
     * mid-band is what kills, and it kills legibly: you watch yourself sink.
     * The token sits at (12,8), the lowest belt cell, one row above the pit.
     * Reaching it costs no time at all — you are sinking anyway — it costs
     * the whole of your margin. That is rule 5's preferred shape: riskier,
     * not more expensive. */
    R('4-02', 'UNDERTOW',
      'Drift can carry you somewhere lethal while you are busy going east.',
      'The safe crossing is the one you enter already moving.',
      ['####################',
       '#......!!!!!!......#',
       '#S.....!!!!!!......#',
       '#......!!!!!!......#',
       '#......!!!!!!......#',
       '#......!!!!!!.....E#',
       '#......!!!!!!......#',
       '#......!!!!!!......#',
       '#......!!!!!o......#',
       '#......xxxxxx......#',
       '#......xxxxxx......#',
       '#......xxxxxx......#',
       '#......xxxxxx......#',
       '####################']),

    /* 4-05. The rotor's arms are axis-aligned, so the four cells diagonal
     * from the hub can never be swept. The pit ring removes the option of
     * going the long way round, which turns that fact into the room: the only
     * standing ground is the inner quadrants, and crossing from one to the
     * next is a two-cell hop across an arm. Entry neck is top-left, exit neck
     * bottom-right, so a clear crosses two arms minimum.
     * The token sits in the bottom-left quadrant, which is off the route
     * entirely and costs two extra arm crossings to visit and leave. */
    R('4-05', 'THE HUB',
      'A beam sweeps a quarter turn per period, and it only sweeps straight.',
      'The safe ground is the four corners beside the hub, not the far wall.',
      ['####################',
       '####################',
       '#####xxxxxxxxx######',
       '#####x.......x######',
       '#S...........x######',
       '#####x.......x######',
       '#####x..R....x######',
       '#####x.......x######',
       '#####x.........E####',
       '#####xo......x######',
       '#####xxxxxxxxx######',
       '####################',
       '####################',
       '####################'],
      { '8,6': { period: 8, phase: 0, len: 3 } }),

    /* 4-06. Two hubs five cells apart on the same row, phases 0 and 2, so
     * they are always pointing opposite ways. Both hubs are solid, so row 6
     * is permanently blocked at x=7 and x=12 and every route weaves above or
     * below them. Passing the left hub on row 5 needs not-beat-0; passing the
     * right hub on row 5 needs not-beat-2. The trip between them is about a
     * beat and a quarter, which is what makes the safe pocket something you
     * move with rather than something you sit in.
     * The token is on row 6 dead between the hubs, the one strip both inner
     * arms cover at beat 1. You may stand there for three beats of four. */
    R('4-06', 'INTERLEAVE',
      'Two sweeps on opposite phases, read together.',
      'The gap between them travels. You travel with it or it closes on you.',
      ['####################',
       '####################',
       '####################',
       '####################',
       '#..................#',
       '#..................#',
       '#S.....R.o..R.....E#',
       '#..................#',
       '#..................#',
       '####################',
       '####################',
       '####################',
       '####################',
       '####################'],
      { '7,6': { period: 8, phase: 0, len: 4 },
        '12,6': { period: 8, phase: 2, len: 4 } })
  ];

  addRooms(4, CH4);

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
