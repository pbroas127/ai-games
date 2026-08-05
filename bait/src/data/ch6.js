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
        '17,12': { link: 1 } }),

    /* ------------------------------------------------------------------ 6-06
     * A MIMIC IN A ROTOR PLAZA. The rotor sits dead centre with a five-cell
     * arm, and the four things this room contains are sitting on the four
     * places that arm reaches: the corridor you walk in through, the token,
     * the teleport that leaves, and the mimic. Every doorway in the room is a
     * swept cell. The corners are the only rest you get.
     *
     * ON THE MIMIC BEING FAIR. This is 5-04's contract and 6-01's: the door
     * the room MADE you earn is the real one, the door that is simply lying
     * open is the lie. The way out is the teleport at the east tip, which
     * costs you a beam window to touch and drops you in a sealed pocket with
     * the real exit. The mimic is at the south tip, one cell past the plaza
     * edge, exactly where a player running for the nearest gap will find it.
     * Verifying that costs a full sweep, because the two candidates are on
     * opposite arms and you cannot look at both from one safe corner.
     *
     * (Atlas: I read "verifying costs a full sweep" as the tell being a lap,
     * not as touching a door to test it. A test-by-touch is a coin flip with
     * death on one side and I will not build one. Say the word if you meant
     * something else and I will rebuild this room.)
     *
     * The four blocks in the quadrants keep the plaza from being an empty
     * field: the ring and the two axes are the only ways across, so crossing
     * an arm is a decision rather than a stroll. The token is at the north
     * tip, which is the arm furthest from the way out. */
    R('6-06', 'SECOND OPINION',
      'Every door in the room sits at the tip of the beam.',
      'One of the two doors is the exit. The one you did not work for is not.',
      ['####################',
       '#########o##########',
       '#####.........######',
       '#####.##...##.######',
       '#####.##...##.######',
       '#####.........######',
       '#S.......R....W#####',
       '#####.........######',
       '#####.##...##.######',
       '#####.##...##.######',
       '#####.........######',
       '#########M##########',
       '################W.E#',
       '####################'],
      { '9,6':   { period: 6, phase: 0, len: 5 },
        '14,6':  { link: 1 },
        '16,12': { link: 1 } }),

    /* ------------------------------------------------------------------ 6-07
     * PHASE GATES OVER A CLOSED BELT. Every floor cell in this room except the
     * one you start on is a conveyor, and they are wired into one clockwise
     * loop around a solid block. That is the whole idea: there is no cell in
     * the room where your speed is zero. Walk with the belt and you make
     * 3px/tick, hold nothing and you drift at 1, walk against it and you crawl
     * back at 1. Nothing you can press stops you.
     *
     * So you are never permitted to wait at the door. The exit gate at (9,2)
     * opens on a ten-beat cycle and the belt under the mouth of it is running
     * EAST, away from where you came from. Arrive early and it carries you
     * past; the only way back to the mouth is to crawl upstream at a third of
     * your walking speed, or give up and take the whole loop again. Overshoot
     * is the punishment this room deals in.
     *
     * The two plugs on the loop itself are not there to block you, they are
     * there to stop the belt from being a free ride. Pinned against a shut
     * plug you are not resting, you are queuing: the moment it opens the belt
     * feeds you into it at 1px/tick, and standing inside one when it shuts is
     * a crush, not a shove.
     *
     * The token gate at (9,11) runs on the same ten beats at the opposite
     * parity, so it is shut whenever the exit gate is open. You cannot take
     * both on one pass, and a mistimed grab seals you in the pocket for a full
     * cycle while the clock runs. That is the strictly worse line, and it is
     * worth about a lap. */
    R('6-07', 'NO BRAKES',
      'A closed belt loop. There is no cell in this room where you stand still.',
      'Overshoot the door and the floor carries you all the way round again.',
      ['####################',
       '#CCCCCCCCCCCCC%CCC!#',
       '#I#######%########!#',
       '#I#######E########!#',
       '#I################!#',
       '#I################!#',
       '#S################!#',
       '#I################!#',
       '#I################!#',
       '#I################!#',
       '#I#######o########!#',
       '#I#######%########!#',
       '#IJJJ%JJJJJJJJJJJJJ#',
       '####################'],
      { '14,1':  { period: 6,  phase: 0 },
        '5,12':  { period: 6,  phase: 1 },
        '9,2':   { period: 10, phase: 1 },
        '9,11':  { period: 10, phase: 0 } }),

    /* ------------------------------------------------------------------ 6-08
     * THE LONG ROOM. One corridor that crosses the screen three times, and
     * each crossing is a different problem laid on top of the same one: a
     * turret firing head-on down the whole length of the lane you are in.
     *
     * You cannot outrun a bullet and the lanes are sixteen cells, so each lane
     * has alcoves. What makes this the long room is that the alcoves are not
     * safe: every one of them is the north arm of a one-cell rotor buried in
     * the wall beneath it, so a shelter is only shelter for three beats in
     * four. There is no cell on the route where both clocks are stopped, which
     * is the brief for this room stated exactly.
     *
     * Rotor arms are one cell long on purpose. A long arm in a corridor this
     * tight would be a wall of red, and 1-04 is the density reference: what
     * makes this hard is that two cheap cadences overlap, not that there is
     * more of anything.
     *
     * The turret cadence eases off as you descend, 18, 18, 17, because the
     * alcove spacing tightens and the lanes get busier. The token hangs in a
     * two-cell spur off the middle lane, in the EAST arm of the rotor at
     * (8,4), so the grab is timed against a clock you were not watching. */
    R('6-08', 'THE LONG WAY',
      'Three crossings, three turrets, and every shelter is on a clock too.',
      'Nowhere on the route are both clocks stopped at the same time.',
      ['####################',
       '####################',
       '#S................T#',
       '####.###.###.##.#.##',
       '####R###Ro##R##R#.##',
       '#########.#######.##',
       '#T................##',
       '##.#.##.###.###.####',
       '##.#R##R###R###R####',
       '##.#################',
       '##................T#',
       '#####.###.###.###E##',
       '#####R###R###R######',
       '####################'],
      { '18,2':  { dir: 7, period: 18, phase: 0 },
        '1,6':   { dir: 3, period: 18, phase: 0 },
        '18,10': { dir: 7, period: 17, phase: 0 },
        '4,4':   { period: 5, phase: 0, len: 1 },
        '8,4':   { period: 5, phase: 1, len: 1 },
        '12,4':  { period: 5, phase: 2, len: 1 },
        '15,4':  { period: 5, phase: 3, len: 1 },
        '4,8':   { period: 4, phase: 2, len: 1 },
        '7,8':   { period: 4, phase: 0, len: 1 },
        '11,8':  { period: 4, phase: 3, len: 1 },
        '15,8':  { period: 4, phase: 1, len: 1 },
        '5,12':  { period: 6, phase: 0, len: 1 },
        '9,12':  { period: 6, phase: 2, len: 1 },
        '13,12': { period: 6, phase: 1, len: 1 } }),

    /* ------------------------------------------------------------------ 6-09
     * A FALLER LATTICE INSIDE A TURRET GALLERY. Nine chambers in a three by
     * three grid, and every door between them is a single faller. A faller
     * holds you once and is a hole the moment you step off it, so every door
     * in this room is consumed by the act of walking through it. That is the
     * brief: every safe tile is spent at the moment you use it.
     *
     * There are twelve doors and you need four of them, so the room is not
     * about finding THE route, it is about not spending a door you still
     * needed. Walk into a chamber whose remaining doors you have already
     * burnt and the room is over with nothing on screen having killed you,
     * which is why the doors are laid out on a plain grid: the map has to be
     * readable at a glance or that death is not legible.
     *
     * The three turrets sit in the border wall and each one fires the full
     * width of the room, straight through the door line of its chamber row.
     * Chambers are three and four cells tall, so there is always a row above
     * or below the shot to stand in. The six horizontal doors sit ON the
     * firing lines and the six vertical doors do not, so which door you spend
     * decides whether you spend it under fire.
     *
     * The token is in the bottom-left chamber, which has two doors and is on
     * nobody's shortest line. */
    R('6-09', 'TWELVE DOORS',
      'Every door is a faller, so every door you use is a door you destroy.',
      'You need four of the twelve, and the room will not tell you which four.',
      ['####################',
       '#S....#.....#......#',
       'T.....f.....f......#',
       '#.....#.....#......#',
       '###f#####f#####f####',
       '#.....#.....#......#',
       '#.....f.....f......T',
       '#.....#.....#......#',
       '###f#####f#####f####',
       '#.....#.....#......#',
       'T.....f.....f......#',
       '#..o..#.....#......#',
       '#.....#.....#.....E#',
       '####################'],
      { '0,2':  { dir: 3, period: 14, phase: 0 },
        '19,6': { dir: 7, period: 12, phase: 0 },
        '0,10': { dir: 3, period: 16, phase: 0 } })

  ]);

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
