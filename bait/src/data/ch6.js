/* BAIT — CHAPTER 6: THE GAUNTLET (15 rooms).
 *
 * AUTHOR: Crucible. Arc, briefs and the design contract are Atlas's, in the
 * header of src/data/chapters.js. Every room below executes the brief written
 * there; where a brief needed a ruling to become buildable, the ruling is in
 * that room's comment and was raised in #bait build rather than made quietly.
 *
 * Chapter 6 is the only chapter where pieces are allowed to combine freely.
 * That makes two of Atlas's rules harder to keep, not easier, so they are
 * repeated here because they are what this file is judged on:
 *
 *   HAZARD IS A MINORITY. 1-04 is the density reference. Walls carry the
 *   composition; a screen that is mostly hazard is noise, not difficulty.
 *   Difficulty here comes from hazards that OVERLAP, not from more of them.
 *
 *   NOTHING IS SOLVED BY STANDING STILL (contract rule 7, ch3 onward). Where
 *   a room needs you to arrive on a beat, the room gives you a way to spend
 *   the time MOVING — a longer line, a belt to walk against, a loop to run.
 *
 * par is null on every room. Sieve's solver computes it. Never hand-tune it.
 */
(function (BAIT) {
  'use strict';

  var R = BAIT.Chapters.R;

  /* Boss's brief names addRooms; chapters.js on disk exports the same function
   * as attach. Resolving both here means this file loads whichever name Atlas
   * settles on, and it is one line rather than a flag day across five files. */
  var addRooms = BAIT.Chapters.addRooms || BAIT.Chapters.attach;

  addRooms(6, [

    /* ------------------------------------------------------------------ 6-01
     * INVENTORY CHECK. Every piece in the game appears exactly once and none
     * of them are layered on each other. Four lanes, each entered by a
     * different mechanism: a gap, a teleport, a gate, and the drop past the
     * turret. That is the "inventory" made into a route rather than a list.
     *
     * The mimic is here and it is fair, on 5-04's terms: the gate delivers you
     * into the TOP strip of the last lane and the real exit is at the end of
     * it. The mimic is at the end of the BOTTOM strip, which is the strip you
     * only enter if you went for the token. A greedy run is the one that ends
     * up standing next to the lie, which is the whole chapter in miniature.
     *
     * It is easy on purpose and it is the last easy room in the game. */
    R('6-01', 'INVENTORY',
      'Every piece in the game, once each, none of them combined.',
      'None. It is easy, and it is the last easy room you get.',
      ['####################',
       '#S..CCC....x..%....#',
       '#..................#',
       '##################.#',
       '#W..............<..#',
       '#..k...............#',
       '##########T#########',
       '#........_........W#',
       '#.............R....#',
       '#G##################',
       '#.................E#',
       '#.########f#########',
       '#....o............M#',
       '####################'],
      { '14,1': { period: 8, phase: 0 },
        '10,6': { dir: 1, period: 12, phase: 0 },
        '1,4':  { link: 2 },
        '18,7': { link: 2 },
        '9,7':  { link: 1, mode: 1 },
        '1,9':  { link: 1 },
        '14,8': { period: 6, phase: 0, len: 1 } }),

    /* ------------------------------------------------------------------ 6-02
     * THE BELT SETS THE BEAT. One belt, one turret, one rotor, and the belt is
     * the point: on it you have exactly three speeds and none of them is stop.
     * Walk east and you make 3px/tick, hold nothing and you drift at 1, walk
     * west and you crawl BACKWARD at 1. So you can still choose when you
     * arrive at the rotor, but you choose it by committing early, a long way
     * back, and every correction costs you ground.
     *
     * The rotor at 12,8 can only ever point north — the three other quarters
     * are buried in wall — so the cell it kills is a single readable cell that
     * shutters open and shut. The turret at 7,8 puts one bullet through the
     * belt for about thirteen ticks a cycle: a flick, not a wall.
     *
     * That is why waiting is not available and not needed (contract rule 7).
     * You are always moving; the question is only how fast. */
    R('6-02', 'CADENCE BELT',
      'A conveyor takes your timing away and leaves you three speeds.',
      'The only way to lose ground is to walk backwards, and sometimes you must.',
      ['####################',
       '#S.................#',
       '#..................#',
       '#.##################',
       '#.##################',
       '#.##################',
       '#.##################',
       '#.CCCCCCCCCCCCCCCC.#',
       '#######T####R#####.#',
       '##################.#',
       '#..................#',
       '#.###############..#',
       '#E###############o.#',
       '####################'],
      { '7,8':  { dir: 1, period: 12, phase: 0 },
        '12,8': { period: 6, phase: 1, len: 1 } }),

    /* ------------------------------------------------------------------ 6-03
     * LATCH PARITY OVER FALLERS. The band at row 3 is the whole room: three
     * ways through it, and they are not equivalent. The middle one is a latch
     * plate, so every trip through it FLIPS the exit gate. The other two are
     * fallers, so they are one-way and there are exactly two of them.
     *
     * Down through the plate and back up through the plate is two flips, which
     * is the gate shut and the room lost with nothing on screen to tell you
     * why — so the room says it out loud instead: the gate is visibly open the
     * moment you land, and visibly shut again if you climb back the way you
     * came. Go down the plate, come back over a faller. One flip. Odd.
     *
     * The token is inside the walled plaza, which no route needs to enter, and
     * it costs the same coming or going, so the parity puzzle stays clean of
     * it. The second faller is genuinely spare: it is there so the room can be
     * solved from either side, not as a trap. */
    R('6-03', 'ODD NUMBER',
      'A latch is parity, not a switch. Count your trips, not your plates.',
      'Two ways back and only one of them leaves the gate the way you left it.',
      ['####################',
       '#S...............#E#',
       '#.................G#',
       '###f#####_#####f####',
       '#..................#',
       '#..#############...#',
       '#..#...........#...#',
       '#..#.....o.....#...#',
       '#..#...........#...#',
       '#..#####.#######...#',
       '#......#...........#',
       '#k.....#...........#',
       '#......#...........#',
       '####################'],
      { '18,2': { link: 1 },
        '9,3':  { link: 1, mode: 1 } }),

    /* ------------------------------------------------------------------ 6-04
     * TELEPORT CHAIN UNDER FIRE. Four lanes, and you never walk from one to
     * the next: every lane is sealed and the only door out of it is a teleport
     * pad sitting in an alcove at the far end. So every arrival puts you in a
     * new lane, facing a new turret, on a cadence you did not choose.
     *
     * Every turret fires HEAD-ON into the lane you are crossing, which is the
     * only readable way to do it: the shot comes from the piece you can see,
     * down the line you are standing in. You cannot outrun it (3px/tick against
     * your 2), so the room gives you shelter instead — alcoves off the firing
     * line, two cells wide up top so there is somewhere to move while a shot
     * goes past. Boss's ruling on 2-10 is the rule this room is built to: a
     * defended goal needs a place to stand.
     *
     * The alcove spacing tightens as you descend and the cadence quickens with
     * it: lane A and B are four-cell hops at period 20, lane C is period 19,
     * lane D is three-cell hops at period 15 and zigzags above and below the
     * lane so you are never running a straight line at the end.
     *
     * The token sits at the FAR east end of lane C, four cells past the pad
     * that leaves it. Going for it means crossing the same lane three times
     * instead of one, under the same gun. It is carryable and it is strictly
     * slower, which is the whole rule. */
    R('6-04', 'RELAY UNDER FIRE',
      'Four sealed lanes, four turrets, and teleports are the only doors.',
      'Every arrival drops you into a new lane at a cadence you did not pick.',
      ['####################',
       '####..###..###..#W##',
       '#S................T#',
       '####################',
       '##W#..###..###..##W#',
       '#T.................#',
       '####################',
       '#W##.##.##.#W#.#o###',
       '#.................T#',
       '####################',
       '#######.###.###.##W#',
       '#T.................#',
       '##E##.###.###.######',
       '####################'],
      { '18,2':  { dir: 7, period: 20, phase: 0 },
        '1,5':   { dir: 3, period: 20, phase: 0 },
        '18,8':  { dir: 7, period: 19, phase: 0 },
        '1,11':  { dir: 3, period: 15, phase: 0 },
        '17,1':  { link: 1 }, '18,4':  { link: 1 },
        '2,4':   { link: 2 }, '1,7':   { link: 2 },
        '12,7':  { link: 3 }, '18,10': { link: 3 } }),

    /* ------------------------------------------------------------------ 6-05
     * DEFLECTOR LABYRINTH, ONE PLATE. The plate at (12,9) sits on a shelf with
     * no walkable entrance at all. The only cell that touches it is the rail
     * that runs through it, so the brief is literal here: you reach the plate
     * without owning your heading at any point on the way in.
     *
     * The left shaft is the only place you make a decision, and it has exactly
     * two doors: the arrow at (3,2) and the arrow at (3,8). One ride ends on
     * the token, the other threads the plate. Neither ride can be steered and
     * neither can be aborted, so the choice is made before you step in, which
     * is what the piece is for after Boss's ruling. Deflectors are rails.
     *
     * EVERY ARROW IN THIS ROOM POINTS SOUTH OR EAST. That is not decoration,
     * it is the proof that there is no closed loop to trap a live player in:
     * a ride's position is monotonic in x + y, so no ride can return to a cell
     * it has already left. Both rides end by dropping into the bottom corridor,
     * which walks back to the shaft, so no wrong choice can strand you either.
     *
     * There is nothing lethal in this room. The cost of a bad read is the
     * climb back up, and in a chapter this dense one room where the danger is
     * purely comprehension is worth its slot. */
    R('6-05', 'ONE WAY DOWN',
      'Deflectors are rails. The plate has no door, only a rail through it.',
      'You pick your ride from the shaft, and that is the last choice you get.',
      ['####################',
       '#S.#################',
       '#..>.........v######',
       '#..##########.######',
       '#..##########.######',
       '#..##########.######',
       '#..##########>..o###',
       '#..#############.###',
       '#..>......v#####.###',
       '#..#######>._.v#.###',
       '#..###########.#.###',
       '#..###########.#.###',
       '#................GE#',
       '####################'],
      { '12,9':  { link: 1, mode: 1 },
        '17,12': { link: 1 } })

  ]);

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
