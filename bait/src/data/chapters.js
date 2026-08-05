/* BAIT — the campaign.
 *
 * OWNER: Atlas. 80 hand-authored rooms across 6 chapters.
 *
 * Rooms are authored as CHARACTER GRIDS using the authoring chars defined in
 * src/core/pieces.js (owned by Boss). Every grid is exactly GRID_H (14) lines
 * of GRID_W (20) characters. Parameters that a piece needs (dir, period,
 * phase, link, len, mode) are supplied in `params`, keyed "x,y", and handed
 * with the grid to BAIT.Room.fromText(lines, paramMap).
 *
 *   . floor      # wall       S start      E exit       f faller
 *   x pit        k key        o token      M mimic exit
 *   ^ > v <  deflector N/E/S/W        I C ! J  conveyor N/E/S/W
 *   T turret (dir, period, phase)      R rotor (period, phase, len)
 *   G gate (link)   _ plate (link, mode: 0 hold / 1 latch)
 *   % phase block (period, phase)      W teleport (link, paired)
 *
 * par is authored as null on purpose. Sieve's solver computes par.time from
 * the optimal solution and writes it back (SPEC §7). Never hand-tune it.
 *
 * ---------------------------------------------------------------------------
 * DESIGN CONTRACT — every room in this file is held to these.
 * ---------------------------------------------------------------------------
 *  1. Readable before it is played. The player can look at the room and form
 *     a plan. The trap is that the plan is wrong, never that the room was
 *     unreadable.
 *  2. One idea per room, stated cleanly, then twisted. No "more stuff" rooms.
 *  3. Difficulty comes from precision of routing and from committing to a
 *     line. Never from memorising invisible information. The single exception
 *     is room 1-11, the faller-teaching death, which earns it once.
 *  4. Death is legible. On dying the player knows instantly which piece did it.
 *  5. THE TOKEN MEDAL REQUIRES REACHING THE EXIT CARRYING IT (Boss ruling).
 *     Grabbing it and then dying earns nothing. So:
 *       - The token always sits on a strictly worse, riskier line. If the
 *         token is on the way, the room is wrong.
 *       - "Worse" normally means RISKIER, not unaffordable. On most rooms the
 *         detour must cost less than Sieve's par margin, so a confident player
 *         takes Swift and Token on one run. That is the satisfying case and it
 *         is meant to be the common one.
 *       - Token and Clear can NEVER be in conflict. A room that forces you to
 *         choose between them is invalid, not clever.
 *       - Token vs Swift conflict is allowed on a deliberate two or three per
 *         chapter, always where the token is dangled somewhere genuinely
 *         expensive. Every one of those is tagged DELIBERATE TOKEN/SWIFT
 *         CONFLICT in its room comment so Sieve does not file it as a bug.
 *  6. Room shape varies: corridors, plazas, spirals, lattices, and symmetric
 *     rooms whose symmetry is a lie.
 *  7. WAITING IS A SOLUTION EXACTLY ONCE, in 2-04, and that is the lesson of
 *     that room. A constant-speed game asking you to stand still is the least
 *     interesting thing it can do. If any room from ch3 on can be solved by
 *     standing still, it is wrong and it gets cut.
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 1 — GROUND FLOOR (13 rooms)
 * Walls, pit, key, exit. Teach movement and cornering. The faller arrives late
 * and kills them, and that death is the tutorial for the entire game.
 * ---------------------------------------------------------------------------
 * 1-01  Walk east to the exit. TEACH: movement, the exit. TWIST: none. The
 *       only genuinely free room in the game, and it is free on purpose.
 * 1-02  A one-cell corridor with exactly two corners in it, and nothing else
 *       in the room at all. TEACH: sliding along a wall, which is the single
 *       most-used motor skill in the game and the first thing a player's hands
 *       must learn. TWIST: none, deliberately. This room is a handshake.
 *       (Requested by Boss so cornering is taught before anything else, and
 *       so Forge has one room that is nothing but the collision he is tuning.)
 * 1-03  A pit wall with one gap. TEACH: pits are lethal and visible. TWIST:
 *       the gap is off-centre, so the straight line is wrong from tile one.
 * 1-04  One key, then the exit. TEACH: the exit stays shut until keys are in.
 *       TWIST: the exit is the first thing you see and the last thing you use.
 * 1-05  Corridor with alternating pit teeth. TEACH: cornering at constant
 *       speed. TWIST: the safe line is a zigzag, so you never run straight.
 * 1-06  Plaza with a pit ring, key in the centre. TEACH: entering and leaving
 *       an enclosed shape. TWIST: the ring's only opening faces away from you.
 * 1-07  Two keys in opposite corners. TEACH: routing order matters. TWIST: the
 *       shorter-looking order ends in a dead end; the longer one loops home.
 *       DELIBERATE TOKEN/SWIFT CONFLICT: the token sits at the far end of the
 *       half that holds no key, so it is a full traversal of dead ground.
 * 1-08  Tight spiral. TEACH: precision in narrow gaps. TWIST: you start at the
 *       centre and unwind outward, which reads backwards.
 * 1-09  Symmetric room, two identical-looking paths. TEACH: reading symmetry.
 *       TWIST: one path is a capped dead end. Symmetry is a lie. Plants ch5.
 * 1-10  A staircase corridor cut through a solid pit field. TEACH: cornering
 *       precision, because every turn is one cell wide. TWIST: the token sits
 *       on a ledge above the field that can only be entered from the far end,
 *       so taking it means running the whole ledge and coming back.
 *       DELIBERATE TOKEN/SWIFT CONFLICT: the ledge is the full width of the
 *       room and it is a there-and-back with no shortcut home.
 *       (Authoring note: stepping stones that touch only at a corner are not
 *       crossable. The dot has radius 7 in a 40px cell and a diagonal corner
 *       cut overlaps both pits, so every path here is orthogonally connected.)
 * 1-11  THE FALLER TEACH. A wide floor bridge over a chasm, key on the far
 *       side, and you must come back. TEACH: a faller looks exactly like floor
 *       and holds you once. TWIST: the bridge you trusted is gone on the
 *       return. This is the death the whole game is built on.
 * 1-12  Three parallel bridges, one faller in each, plus a sealed pocket with
 *       a faller of its own for a door. TEACH: fallers are a budget you spend,
 *       and the order you spend them in is the puzzle. TWIST: a clear needs
 *       two crossings and there are three, so it feels generous. Taking the
 *       token needs the top bridge FIRST. Anyone who crosses the obvious
 *       middle bridge first has already lost the token, and anyone who goes
 *       for the token second strands themselves with every bridge spent.
 * 1-13  CHAPTER END. Key ring around a faller lattice. TEACH: all of ch1.
 *       TWIST: the clear route never touches a faller at all. Only the token
 *       does, and it costs two of them, one to get into the lattice and a
 *       second to get back out carrying it.
 *       NOT a Token/Swift conflict — Sieve measured the detour at roughly 0.1s
 *       inside par, so the token is close to free in TIME. That is correct and
 *       intended here: the price of this token is the FALLER BUDGET, not the
 *       clock. You spend two of the four crossings, and if you try to leave
 *       the ring through the one you came in by, you die. Risk, not seconds,
 *       which is the ratio rule 5 asks for.
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 2 — CADENCE (13 rooms)
 * Turrets and phase blocks. Everything here is reading a fixed rhythm and
 * committing to it. Nothing in this chapter is ever random.
 * ---------------------------------------------------------------------------
 * 2-01  One turret across an empty corridor. TEACH: bullets, lanes, cadence.
 *       TWIST: none. Watch the beat, then walk.
 * 2-02  Two turrets, one lane, opposite ends, offset phase. TEACH: phase.
 *       TWIST: the safe window sits between two bullets, not before one.
 * 2-03  Turret lane with pits on both sides. TEACH: you cannot dodge sideways.
 *       TWIST: the only dodge is forward, so the room forces commitment.
 * 2-04  Phase block as the exit door. TEACH: solid, then not, on a beat.
 *       TWIST: you have to wait, and this is the only room that asks that.
 * 2-05  Phase corridor, alternating parity. TEACH: walking a rhythm. TWIST:
 *       constant speed carries you through perfectly if you never stop, so
 *       hesitation is the only thing that kills you.
 * 2-06  Phase block shielding a turret lane. TEACH: pieces combine. TWIST: the
 *       shield is open at exactly the moment the turret fires.
 * 2-07  Four turrets around a plaza, firing radially. TEACH: many cadences at
 *       once. TWIST: their periods share one long safe window in the centre.
 * 2-08  Long turret gallery on a slow period. TEACH: patience versus speed.
 *       TWIST: the token is only reachable on the slow window, so the run that
 *       carries it out cannot also be the fast one.
 *       DELIBERATE TOKEN/SWIFT CONFLICT, approved by Boss by name. The token
 *       is still carried to the exit, so Clear is never in conflict.
 * 2-09  Phase maze. TEACH: routing through time, not space. TWIST: the room is
 *       fully open for one instant per cycle, and spotting it is the puzzle.
 * 2-10  Turret aimed down the exit approach. TEACH: the goal is defended.
 *       TWIST: the tile you want most is the most dangerous tile in the room.
 * 2-11  Faller bridge under turret fire. TEACH: ch1 knowledge under pressure.
 *       TWIST: there is a safe alcove halfway across, so the crossing splits
 *       into two readable beats and you may stop and re-read the lane.
 *       This is the GENTLE statement of the idea. 2-13 takes the safety off.
 * 2-12  Phase blocks that reshape the route. TEACH: the room's shape changes.
 *       TWIST: the corridor that exists on beat A is a dead end on beat B, so
 *       you must enter on the correct beat, not merely survive.
 * 2-13  CHAPTER END. Gallery of turret cadence, phase gates, one faller exit.
 *       TWIST: 2-11's crossing with the alcove removed. No refuge, no second
 *       beat, and the only clean line needs it crossed in the opening three
 *       seconds, before you have read the rest of the room. You commit on
 *       incomplete information, which is the chapter's real final exam.
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 3 — LINKAGE (13 rooms)
 * Gates, plates (hold versus latch), teleports. Routing puzzles where the
 * shortest line is not the legal one.
 * ---------------------------------------------------------------------------
 * 3-01  One latch plate, one gate. TEACH: latch toggles and stays. TWIST: none.
 *       A clean statement of the mechanic before it is used against you.
 * 3-02  Two latch plates, two gates, crossed links. TEACH: link numbers.
 *       TWIST: opening one gate closes your route back to the other plate.
 * 3-03  Hold plate directly adjacent to its gate. TEACH: hold opens only while
 *       you overlap it. TWIST: the gate must be brushed past in the same
 *       moment you touch the plate. One cell of margin.
 * 3-04  Teleport pair. TEACH: you exit the twin with heading intact. TWIST:
 *       heading intact means you arrive moving, and there is a pit ahead.
 * 3-05  Two teleport pairs. TEACH: reading link numbers at a glance. TWIST:
 *       the pairs are laid out so the wrong ones look paired.
 * 3-06  A latch plate that shuts the door behind you. TEACH: commitment.
 *       TWIST: the token is on the wrong side of that door.
 * 3-07  Gate corridor with plates in a loop. TEACH: order of operations.
 *       TWIST: the loop must be run twice, and the second lap must be faster.
 * 3-08  Teleport into a turret lane. TEACH: know where you land. TWIST: the
 *       landing tick is deterministic and readable, but only if you count.
 * 3-09  Hold plate holding a gate that blocks a turret lane. TEACH: gates stop
 *       bullets. TWIST: staying safe means standing still, and leaving the
 *       plate opens the lane you are standing in.
 * 3-10  Teleport maze, four pairs. TEACH: mental routing. TWIST: one pair
 *       loops back on itself and wastes the traversal that costs you Swift.
 * 3-11  Latch parity puzzle. TEACH: toggles are parity, not switches. TWIST:
 *       crossing a plate an even number of times undoes all of your work.
 * 3-12  The plate sits past a faller. TEACH: irreversible plus stateful.
 *       TWIST: you get exactly one trip to set the room's state correctly.
 * 3-13  CHAPTER END. Three links, one teleport, shortest line illegal. TWIST:
 *       the legal line is nearly double the length, so Swift demands the
 *       risky teleport shortcut that the room spent 12 rooms teaching you to
 *       distrust.
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 4 — DRIFT (13 rooms)
 * Conveyors, deflectors, rotors. You no longer fully own your heading.
 * ---------------------------------------------------------------------------
 * 4-01  A single conveyor strip. TEACH: drift adds to your velocity. TWIST:
 *       walking against it is slower, but it is possible, and that matters.
 * 4-02  Conveyor pointed at a pit. TEACH: drift can carry you into death.
 *       TWIST: the safe move is to enter the belt already moving across it.
 * 4-03  Deflector. TEACH: your heading is slammed to the arrow and you keep
 *       moving. TWIST: it points somewhere useful. This once.
 * 4-04  Deflector chain. TEACH: chained redirection. TWIST: entering the chain
 *       one cell higher gives a completely different exit.
 * 4-05  Rotor in an open plaza. TEACH: a beam sweeping a quarter turn per
 *       period. TWIST: the safe ground is near the hub, not far from it.
 * 4-06  Two rotors on interleaved phases. TEACH: reading two sweeps. TWIST:
 *       the gap between them travels, so you have to travel with it.
 * 4-07  Conveyor crossing a deflector. TEACH: losing heading and position at
 *       once. TWIST: the arrow fights the belt and the belt wins on one axis.
 * 4-08  Rotor over a conveyor. TEACH: you cannot stand still under a beam.
 *       TWIST: the belt feeds you into the sweep unless you walk against it.
 * 4-09  A deflector used as a one-way door. TEACH: one-way by physics, not by
 *       state. TWIST: the token is on the far side of it.
 * 4-10  Rotor gallery in a corridor. TEACH: timing a sweep in a tight space.
 *       TWIST: at constant speed the only variable you control is when you
 *       start, so the room is a single decision made well.
 * 4-11  Conveyor ring. TEACH: circular drift. TWIST: the exit is reachable
 *       only by leaving the ring tangentially at one specific point.
 * 4-12  Rotor plus turret. TEACH: two cadences with different geometry.
 *       TWIST: their safe windows never coincide, so you use the rotor's own
 *       hub as cover from the bullets.
 * 4-13  CHAPTER END. Belts, three deflectors, two rotors. TWIST: you own your
 *       heading for roughly four ticks in the entire room.
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 5 — THE LIARS (14 rooms)
 * Fallers used as real traps, and the mimic exit arrives. The mimic is used
 * sparingly and always where the player has already learned to trust a shape.
 * ---------------------------------------------------------------------------
 * 5-01  Faller field, honest opening. TEACH: recall. TWIST: the field must be
 *       crossed twice and there is exactly one spare crossing in it.
 * 5-02  A faller inside a route you are asked to repeat. TEACH: repetition
 *       consumes. TWIST: the room asks for three laps and gives you two.
 * 5-03  A faller as your only retreat. TEACH: burning your own exit. TWIST:
 *       the correct play is to burn it early, deliberately.
 * 5-04  MIMIC INTRODUCED FAIRLY. Two exits side by side, one is a mimic.
 *       TEACH: the exit itself can lie. TWIST: the real one is identifiable
 *       from context, because the key path leads to it. A fair first meeting.
 * 5-05  Mimic at the end of the obvious line, real exit off the natural route.
 *       TEACH: the obvious is bait. TWIST: the mimic sits exactly where every
 *       chapter 1 room put its exit. It punishes learned trust, precisely.
 * 5-06  Two mimics, one exit. TEACH: elimination. TWIST: key placement tells
 *       you which is real, if you bother to read it before you run.
 * 5-07  Faller and mimic together. TEACH: both liars at once. TWIST: reaching
 *       the wrong exit costs you the faller too, so the retry line differs.
 * 5-08  Symmetric room, mirrored exits. TEACH: symmetry is a lie. A direct
 *       callback to 1-09. TWIST: the asymmetry is exactly one tile wide.
 * 5-09  A mimic with a turret behind it. TEACH: the lie is also defended.
 *       TWIST: walking close enough to verify it is itself lethal.
 * 5-10  Faller bridge network. TEACH: planning a spanning route. TWIST: it is
 *       a graph problem, and every bridge may be crossed at most once.
 * 5-11  Mimic plus teleport. TEACH: arriving somewhere you did not choose.
 *       TWIST: the teleport dumps you facing the mimic, at full speed.
 * 5-12  THE HONEST ROOM. TEACH: nothing lies here at all. TWIST: by chapter 5
 *       the player will not believe that, and hesitation is what costs them
 *       Swift. The trap is the player's own paranoia and nothing else.
 * 5-13  Everything lies, placed sparingly. TEACH: reading tells. TWIST: only
 *       two pieces in the room lie, and they are the two you must touch.
 * 5-14  CHAPTER END. One faller and one mimic, both load-bearing. TWIST: the
 *       token sits past the faller that the SAFE exit line needs. Spend it on
 *       the token and the only way left to the real exit threads past the
 *       mimic at full speed. Both medals are reachable on one run, but only
 *       by committing to the dangerous ending.
 *       (Reworked. The original made Token and Clear mutually exclusive,
 *       which Boss's carry-it-to-the-exit ruling makes invalid.)
 *
 * ---------------------------------------------------------------------------
 * CHAPTER 6 — THE GAUNTLET (15 rooms)
 * Everything at once. Gated on medal count, and unapologetically hard.
 * ---------------------------------------------------------------------------
 * 6-01  Every piece appears once, none combined. TEACH: inventory check.
 *       TWIST: it is easy, and it is the last easy room in the game.
 * 6-02  Turret, rotor and conveyor. TWIST: the belt sets your speed through
 *       both cadences, so you cannot choose your own timing.
 * 6-03  Latch parity over fallers. TWIST: the parity needs an odd number of
 *       crossings and the fallers only permit an even number.
 * 6-04  Teleport chain under fire. TWIST: every arrival lands in a new lane.
 * 6-05  Deflector labyrinth with one plate. TWIST: you have to reach the plate
 *       without owning your heading at any point.
 * 6-06  A mimic in a rotor plaza. TWIST: verifying which exit is real costs a
 *       full sweep of the beam.
 * 6-07  Phase maze over conveyors. TWIST: the belt makes the beat and you are
 *       never permitted to wait for it.
 * 6-08  The long room. TWIST: three rooms of sustained pressure with no safe
 *       pause anywhere in it.
 * 6-09  Faller lattice inside a turret gallery. TWIST: every safe tile is
 *       consumed at the moment you use it.
 * 6-10  Full routing: three links, two teleports, one mimic. TWIST: the mimic
 *       sits on the fastest otherwise-legal line.
 * 6-11  Precision plaza, four rotors and nothing else. TWIST: no puzzle at
 *       all, pure execution, and it is brutal.
 * 6-12  Perfect symmetry. TWIST: a single faller breaks it, and which half it
 *       breaks depends on which half you entered from.
 * 6-13  Everything, at medium size. TWIST: the token line is the clear line
 *       run in reverse.
 * 6-14  Penultimate. TWIST: it is the final room with two pieces removed, and
 *       the player is not told that.
 * 6-15  FINALE. TWIST: it is 6-14 with those two pieces put back. You already
 *       know the shape, you have already practised the line, and it still
 *       very nearly kills you.
 * ---------------------------------------------------------------------------
 *
 * MEDAL BUDGET: 81 rooms x 4 medals = 324 total.
 * Medals available before chapter 6 = 66 rooms x 4 = 264.
 * Chapter 6 unlocks at 80% of those 264 = 211. See `unlock` below.
 * (Was 208 against a 65-room pre-ch6 count. Adding 1-02 TWO CORNERS moved it.)
 */
(function (BAIT) {
  'use strict';

  /* Room constructor. par is always null here — Sieve's solver computes it
   * from the optimal solution and writes it back (SPEC §7). */
  function R(id, name, teaches, twist, lines, params) {
    return {
      id: id, name: name, teaches: teaches, twist: twist,
      lines: lines, params: params || {}, par: null
    };
  }

  /* ------------------------------------------------------------ chapter 1 --
   * GROUND FLOOR. No parameterised pieces appear in this chapter, so every
   * room ships an empty param map. Grids are 14 lines of 20 characters. */
  var CH1 = [

    /* One full-height wall with the gap at the bottom. You cannot die here and
     * you cannot fail, but no single held direction clears it: E stops on the
     * wall, SE slides down and along the floor past the exit, NE slides up to
     * the ceiling. The player has to make one real decision. Deliberately a
     * wide open shape so it reads as nothing like 1-02's tight corridor. */
    R('1-01', 'PLATE ONE',
      'Movement, and that a wall is honest.',
      'None. You cannot die in this room. You still have to choose a way round.',
      ['####################',
       '#o.......#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#S.......#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#........E#',
       '#........#.........#',
       '#..................#',
       '####################']),

    /* The two corners turn the SAME way, making a C rather than an L. An L can
     * be cleared by holding one diagonal, because wall-sliding carries the dot
     * around the bend for free — the first cut of this room shipped that bug
     * and the hold-lint caught it. A switchback cannot be slid through. */
    R('1-02', 'TWO CORNERS',
      'Sliding along a wall, the most-used motor skill in the game.',
      'None. This room is a handshake, and it is the only one.',
      ['####################',
       '####################',
       '####################',
       '####################',
       '#E.......###########',
       '########.###########',
       '########.###########',
       '######o..###########',
       '########.###########',
       '########.###########',
       '########.###########',
       '#S.......###########',
       '####################',
       '####################']),

    R('1-03', 'THE GAP',
      'Pits are lethal, and visibly so.',
      'A second gap exists, is obvious, and leads nowhere.',
      ['####################',
       '#.........x........#',
       '#.........x........#',
       '#..................#',
       '#.........x........#',
       '#.........x........#',
       '#S........x.......E#',
       '#.........x........#',
       '#.........x........#',
       '#.........x........#',
       '#....xxxxxxxxx.....#',
       '#.......o....x.....#',
       '#....xxxxxxxxx.....#',
       '####################']),

    R('1-04', 'ERRAND',
      'The exit stays shut until every key is in.',
      'The exit is the first thing you see and the last thing you use.',
      ['####################',
       '#..................#',
       '#..#############...#',
       '#..#...........#...#',
       '#..#.E.........#...#',
       '#..#####.#######...#',
       '#......#...........#',
       '#.S....#.#.......k.#',
       '#......#.#.........#',
       '#..#####.#######...#',
       '#..#xxxx.xxxxxx#...#',
       '#..#.....o.....#...#',
       '#..#############...#',
       '####################']),

    R('1-05', 'SWITCHBACK',
      'Cornering at constant speed.',
      'The teeth alternate, so the safe line is a zigzag and never a run.',
      ['####################',
       '####################',
       '####################',
       '#S..x.......x.....E#',
       '#...x.......x......#',
       '#...x.......x......#',
       '#...x...x...x...x..#',
       '#.......x.......x..#',
       '#.......x.......x..#',
       '#.......x.......x.o#',
       '####################',
       '####################',
       '####################',
       '####################']),

    R('1-06', 'THE WELL',
      'Entering and leaving an enclosed shape.',
      'The ring has one opening and it faces away from where you start.',
      ['####################',
       '#S................E#',
       '#..................#',
       '#....xxxxxxxxxx....#',
       '#....x........x....#',
       '#....x........x....#',
       '#....x...k....x....#',
       '#....x........x....#',
       '#....x........x....#',
       '#....xxxxx.xxxx....#',
       '#..................#',
       '#.....xxxxxxxxxx...#',
       '#.......o..........#',
       '####################']),

    R('1-07', 'TWO ERRANDS',
      'Routing order matters.',
      'The half that looks closer to the exit holds no key at all.',
      ['####################',
       '#k........#.......o#',
       '#.........#........#',
       '#.........#........#',
       '#.........#........#',
       '#.........#........#',
       '#....S....#........#',
       '#.........#........#',
       '#.........#........#',
       '#.........####.#####',
       '#..................#',
       '#.................k#',
       '#........E.........#',
       '####################']),

    R('1-08', 'UNWIND',
      'Precision in a one-cell corridor.',
      'You start at the centre and unwind outward, which reads backwards.',
      ['####################',
       '#..................#',
       '#.##############.#.#',
       '#.#..............#.#',
       '#.#.#.##########.#.#',
       '#.#.#..........#.#.#',
       '#.#.#....S.....#.#.#',
       '#.#.#..........#.#.#',
       '#.#.############.#.#',
       '#.#o.............#.#',
       '#.################.#',
       '#..................#',
       '#.................E#',
       '####################']),

    R('1-09', 'TWIN CORRIDORS',
      'Reading a symmetric room.',
      'Symmetry is a lie. One corridor is capped, and you can see which.',
      ['####################',
       '#........S.........#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#.################.#',
       '#o################.#',
       '#x.................#',
       '#........E.........#',
       '#..................#',
       '####################']),

    /* DENSITY PASS after Boss called this a wall of red. It was 79% pit, now
     * 26%, and the route is byte-for-byte the same route.
     *
     * The trick is that only the pits TOUCHING the path do any work. They are
     * what punishes a wide corner, and that is the whole teach. A pit eight
     * cells off the path can never be stepped in by anybody, so it was never
     * difficulty, it was just red. Those are walls now and the staircase reads
     * as a stair cut through solid rock with a drop along its edge.
     *
     * Nothing reachable changed, so the route, the solve and the par are
     * untouched. The wall fill is strictly outside the pit band, so no new
     * surface is slideable and the corners are exactly as tight as they were. */
    R('1-10', 'STAIRCASE',
      'Cornering precision where every turn is one cell wide.',
      'The token ledge can only be entered from the far end of the climb.',
      ['####################',
       '#o.................#',
       '#xxxxxxxxxxx......E#',
       '###########x.xxxxxx#',
       '#######xxxxx.x######',
       '#######x.....x######',
       '#######x.xxxxx######',
       '###xxxxx.x##########',
       '###x.....x##########',
       '###x.xxxxx##########',
       '#xxx.x##############',
       '#S...x##############',
       '#xxxxx##############',
       '####################']),

    R('1-11', 'THE WIDE BRIDGE',
      'A faller looks exactly like floor and holds you exactly once.',
      'The wide safe bridge lies. The tight ugly slot underneath is honest.',
      ['####################',
       '#........xxx.....xo#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#S.......fff.....k.#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#E.................#',
       '####################']),

    R('1-12', 'THREE BRIDGES',
      'Fallers are a budget, and the spending order is the puzzle.',
      'Three bridges for two crossings feels generous. The token costs two.',
      ['####################',
       '#........xxx.....o.#',
       '#........xxx.......#',
       '#.........f........#',
       '#........xxx.......#',
       '#........xxx###f####',
       '#S.......f.........#',
       '#........xxx.......#',
       '#........xxx.......#',
       '#..........f.......#',
       '#........xxx.......#',
       '#........xxx.....k.#',
       '#E.......xxx.......#',
       '####################']),

    R('1-13', 'THE VAULT',
      'Everything chapter one taught, at once.',
      'The clear never touches a faller. The token costs you two of them.',
      ['####################',
       '#S...............k.#',
       '#..................#',
       '#....xxxxfxxxxx....#',
       '#....x........x....#',
       '#....x........x....#',
       '#....f...o....f....#',
       '#....x........x....#',
       '#....x........x....#',
       '#....xxxxfxxxxx....#',
       '#..................#',
       '#k................E#',
       '#..................#',
       '####################'])
  ];

  /* ------------------------------------------------------------ chapter 2 --
   * CADENCE. Turrets and phase blocks. Everything here is a fixed rhythm.
   *
   * The numbers, so the timings can be checked rather than trusted:
   *   player   2 px/tick, so one 40px cell is 20 ticks
   *   bullet   3 px/tick, so it outruns the player and cannot be raced
   *   period   is in units of 10 ticks. period 12 = 120 ticks = 1.0s
   *   turret   fires when (t % period*10) === (phase*10 % period*10)
   *   phase    block is SOLID when (floor(t / period*10) + phase) is even,
   *            so an even phase starts solid at t=0 and an odd phase starts
   *            open. Standing inside one as it closes is death by 'crushed'.
   *   bullets  are absorbed by anything solid, which is why a phase block
   *            sitting in a turret lane works as an intermittent shield.
   */
  var CH2 = [

    /* Teaching room. The wall's only gap sits on the turret's lane, so the
     * way through and the danger are the same tile. Nothing else in the room. */
    R('2-01', 'ONE LANE',
      'Bullets, a lane, and a cadence that never varies.',
      'The only gap in the wall is the lane itself.',
      ['####################',
       '#E.......T.........#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#########.##########',
       '#..................#',
       '#..........o.......#',
       '#..................#',
       '#..................#',
       '#S.................#',
       '#..................#',
       '####################'],
      { '9,1': { dir: 5, period: 12, phase: 0 } }),

    /* Two turrets, one lane, half a period apart. The safe window is BETWEEN
     * two bullets travelling opposite ways, not before one. */
    R('2-02', 'OFFSET',
      'Phase. Two cadences on one lane, offset by half a period.',
      'The gap you want is between two bullets, not in front of one.',
      ['####################',
       '#........#........E#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#T...o............T#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#........#.........#',
       '#S.......#.........#',
       '#........#.........#',
       '####################'],
      { '1,6': { dir: 3, period: 12, phase: 0 },
        '18,6': { dir: 7, period: 12, phase: 6 } }),

    /* Pits on both sides of the lane, so there is no sideways. Corridor is 15
     * cells, 300 ticks at walking speed; the turret is on 400. You enter just
     * after a shot and you do not get to change your mind. */
    R('2-03', 'COMMIT',
      'There is no sideways. The only dodge is forward.',
      'You enter behind a bullet and the corridor decides the rest.',
      ['####################',
       '####################',
       '#S.................#',
       '#..................#',
       '#..................#',
       '#..xxxxxxxxxxxxxxx.#',
       '#T...............E##',
       '#..xxxxxxxxxxxxxxx.#',
       '#..................#',
       '#.o................#',
       '#..................#',
       '####################',
       '####################',
       '####################'],
      { '1,6': { dir: 3, period: 40, phase: 0 } }),

    /* THE ONLY ROOM IN THE GAME THAT ASKS YOU TO WAIT. Phase 0 means the door
     * is shut at t=0 and shut again about when an unhurried player arrives.
     * See design contract rule 7 — this lesson is never repeated. */
    R('2-04', 'THE DOOR',
      'Solid, then not, on a beat you can read.',
      'You have to stand still. It is the only time this game will ask.',
      ['####################',
       '#........o.....#####',
       '#..............#E###',
       '#..............#.###',
       '#..............#.###',
       '#..............#.###',
       '#S.............%.###',
       '#..............#####',
       '#..............#####',
       '#..............#####',
       '#..............#####',
       '#..............#####',
       '#..............#####',
       '####################'],
      { '15,6': { period: 12, phase: 0 } }),

    /* The gaps are 3 cells, 60 ticks, and the period is 60 ticks, with the
     * parity alternating down the line. A player who leaves on tick zero and
     * never stops meets every block open. Hesitation is the only thing in this
     * room that can kill you, which is the whole point of it. The token is
     * above the corridor precisely because collecting it breaks the rhythm. */
    R('2-05', 'CADENCE',
      'Walking a rhythm instead of dodging a thing.',
      'Never stopping is the solution. Stopping is the only mistake.',
      ['####################',
       '####################',
       '####################',
       '###############o####',
       '#E.%..%..%..%...####',
       '###############.####',
       '#S..%..%..%..%..####',
       '####################',
       '####################',
       '####################',
       '####################',
       '####################',
       '####################',
       '####################'],
      { '4,6': { period: 6, phase: 0 }, '7,6': { period: 6, phase: 1 },
        '10,6': { period: 6, phase: 0 }, '13,6': { period: 6, phase: 1 },
        '12,4': { period: 6, phase: 1 }, '9,4': { period: 6, phase: 0 },
        '6,4': { period: 6, phase: 1 }, '3,4': { period: 6, phase: 0 } }),

    /* The block sits IN the lane and eats bullets while it is solid, so the
     * shield being open is exactly what tells you a bullet is coming. The
     * token sits in the lane's shadow directly behind it. */
    R('2-06', 'SHIELD',
      'Solid things absorb bullets, so a phase block is an intermittent wall.',
      'The shield is open at precisely the moment the turret fires.',
      ['####################',
       '#...........#......#',
       '#...........#......#',
       '#...........#......#',
       '#...........#......#',
       '#...........#......#',
       '#T...%o...........E#',
       '#...........#......#',
       '#...........#......#',
       '#...........#......#',
       '#...........#......#',
       '#S..........#......#',
       '#...........#......#',
       '####################'],
      { '1,6': { dir: 3, period: 12, phase: 0 },
        '5,6': { period: 12, phase: 1 } }),

    /* Four lanes, one period, four phases chosen so every bullet reaches the
     * middle at about the same tick. Travel times to the centre differ (53,
     * 67, 93, 107 ticks) so the phases compensate: 6, 4, 2, 0. The result is
     * a ~114 tick window where the centre is the SAFEST cell in the room, and
     * the token sits in it. Reading that window is the room. */
    R('2-07', 'FOUR CORNERS',
      'Several cadences at once, and how to find where they agree.',
      'The most dangerous looking cell is the safest one, on the beat.',
      ['####################',
       '#........T.........#',
       '#................E.#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#T.......o........T#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#.S................#',
       '#........T.........#',
       '####################'],
      { '9,1': { dir: 5, period: 12, phase: 6 },
        '9,12': { dir: 1, period: 12, phase: 4 },
        '1,6': { dir: 3, period: 12, phase: 2 },
        '18,6': { dir: 7, period: 12, phase: 0 } }),

    /* DELIBERATE TOKEN/SWIFT CONFLICT, approved by Boss by name. The run is
     * along the bottom crossing four lanes. The token is eight cells up in the
     * middle of the gallery, so taking it costs the climb both ways AND four
     * extra lane crossings. Carried to the exit, so Clear is never at risk. */
    R('2-08', 'THE GALLERY',
      'Patience against speed, on a deliberately slow period.',
      'The token is only reachable on the slow window. Pick your medal.',
      ['####################',
       '#...T...T...T...T..#',
       '#E................o#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#..................#',
       '#..................#',
       '####.###.#.#.###.###',
       '#S.........#########',
       '####################',
       '####################',
       '####################'],
      { '4,1': { dir: 5, period: 18, phase: 0 },
        '8,1': { dir: 5, period: 18, phase: 4 },
        '12,1': { dir: 5, period: 18, phase: 9 },
        '16,1': { dir: 5, period: 18, phase: 13 } }),

    /* Two corridors, three vertical links, and blocks of OPPOSITE parity on
     * each corridor. There is no instant where both are open, so the room is
     * two different mazes that trade places every beat and you route through
     * time rather than space. */
    R('2-09', 'THE INSTANT',
      'Routing through time. The wall you need is a schedule.',
      'The top and bottom mazes are never open at the same moment.',
      ['####################',
       '####################',
       '####################',
       '####################',
       '#o.....%....%.....E#',
       '###.#####.######.###',
       '###.#####.######.###',
       '###.#####.######.###',
       '#S.....%....%......#',
       '####################',
       '####################',
       '####################',
       '####################',
       '####################'],
      { '7,4': { period: 12, phase: 0 }, '12,4': { period: 12, phase: 0 },
        '7,8': { period: 12, phase: 1 }, '12,8': { period: 12, phase: 1 } }),

    /* REBUILT. The first version put the exit between the player and the
     * token, which is a Token/CLEAR conflict and rule 5 forbids it outright.
     * Forge caught it. The exit is now nowhere near the token line.
     *
     * WHAT A TURRET CAN ACTUALLY DEFEND, measured against the real sim rather
     * than assumed, because the first three rebuilds of this room all leaned
     * on a thing that does not work:
     *
     *   A bullet kills within RADIUS + BULLET_R = 10px of its centre line.
     *   A dot pinned against a wall sits CELL/2 - RADIUS = 13px off that
     *   cell's centre line. 13 > 10, so a dot hugging either wall of a
     *   one-cell corridor is UNHITTABLE. I have stood one in a lane for ten
     *   full shots and it lives.
     *
     * So a turret does not defend a corridor you run ALONG. It defends a line
     * you have to CROSS, because crossing puts you on the centre line whether
     * you like it or not. Every room in this campaign that fires a turret down
     * a lane the player runs the length of is decoration. Raised with Boss and
     * Forge separately; this room is built so it holds either way.
     *
     * The exit here IS the muzzle cell, so a shot spawns inside the doorway on
     * the beat. That is the defence and it is small and honest: you arrive on
     * the wrong beat and the doorstep kills you.
     *
     * DELIBERATE TOKEN/SWIFT CONFLICT, and this time it is a real one. Clear
     * runs 570 ticks, carrying the token runs 857. The 2.4s buys a seven-cell
     * dead end with a pit wall on each side and no room to correct in.
     */
    R('2-10', 'THE DOORSTEP',
      'The goal itself is defended.',
      'The exit is the muzzle. It is open, and it is loaded.',
      ['####################',
       '####################',
       '####################',
       '#........T.........#',
       '#........E.........#',
       '#..................#',
       '#################..#',
       '#..................#',
       '#xxxxxxx...........#',
       '#o.................#',
       '#xxxxxxx...........#',
       '#S.................#',
       '####################',
       '####################'],
      { '9,3': { dir: 5, period: 12, phase: 0 } }),

    /* THE GENTLE STATEMENT. The bridge is two faller spans with a real floor
     * island between them, and an alcove above the island that is out of the
     * lane. The island is floor on purpose: stepping off a FALLER to reach the
     * alcove would consume it and strand you on the way back down. So the
     * crossing splits into two readable beats. 2-13 removes the island. */
    R('2-11', 'THE ALCOVE',
      'Chapter one under fire, with somewhere to stop and re-read it.',
      'Two spans, one refuge. Retreat still costs you the span behind you.',
      ['####################',
       '#......xxxxxxx....o#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxx.xxx.....#',
       '#T.....fff.fff....E#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#S.....xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '####################'],
      { '1,6': { dir: 3, period: 12, phase: 0 } }),

    /* Two branches off one junction, gated by blocks of opposite parity, so
     * exactly one is open at any beat. At t=0 the branch that is open is the
     * one holding the token, and the exit branch is shut. The room opens by
     * inviting you the wrong way. */
    R('2-12', 'RESHAPE',
      'The room changes shape. Enter on the wrong beat and it is a dead end.',
      'The branch that is open when you arrive is not the one you want.',
      ['####################',
       '####################',
       '#E.........#########',
       '##########.#########',
       '##########.#########',
       '##########%#########',
       '#S.........#########',
       '##########%#########',
       '##########.#########',
       '##########.#########',
       '##########o#########',
       '####################',
       '####################',
       '####################'],
      { '10,5': { period: 12, phase: 0 }, '10,7': { period: 12, phase: 1 } }),

    /* CHAPTER END. 2-11 with the island and the alcove taken away: seven
     * faller cells in one unbroken span, no refuge, no retreat. The gate is
     * the only way onto the bridge and it is ON the lane, so the moment it
     * opens for you is also the moment a bullet can come through it. You go
     * in behind a bullet, on the beat, or you do not go in. */
    R('2-13', 'FINAL EXAM',
      'Two independent cadences and one crossing that cannot be undone.',
      'The gate opening is also the bullet\'s door. Follow one through.',
      ['####################',
       '#......xxxxxxx....o#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#T....%fffffff....E#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '#S.....xxxxxxx.....#',
       '#......xxxxxxx.....#',
       '####################'],
      { '1,6': { dir: 3, period: 20, phase: 0 },
        '6,6': { period: 10, phase: 1 } })
  ];

  /* Chapter metadata. `unlock` is the medal count required to open it.
   * `rooms` is filled per chapter below as each chapter is authored and
   * verified end to end. */
  var CHAPTERS = [
    { n: 1, key: 'ground', title: 'GROUND FLOOR',
      blurb: 'Walls hold. Pits kill. Floor is floor. Mostly.',
      unlock: 0, rooms: CH1 },

    { n: 2, key: 'cadence', title: 'CADENCE',
      blurb: 'Nothing here is random. That is not the same as safe.',
      unlock: 8, rooms: CH2 },

    { n: 3, key: 'linkage', title: 'LINKAGE',
      blurb: 'The shortest line is not the legal one.',
      unlock: 26, rooms: [] },

    { n: 4, key: 'drift', title: 'DRIFT',
      blurb: 'You no longer entirely own your heading.',
      unlock: 52, rooms: [] },

    { n: 5, key: 'liars', title: 'THE LIARS',
      blurb: 'Two pieces in this game can lie. Here they both do.',
      unlock: 84, rooms: [] },

    { n: 6, key: 'gauntlet', title: 'THE GAUNTLET',
      blurb: 'Everything at once. No apologies.',
      unlock: 211, rooms: [] }
  ];

  /* Planned room counts, asserted by tools/verify.cjs so a missing room is a
   * hard failure rather than a quietly short campaign. */
  var PLANNED = [13, 13, 13, 13, 14, 15];

  function allRooms() {
    var out = [], i, j;
    for (i = 0; i < CHAPTERS.length; i++) {
      for (j = 0; j < CHAPTERS[i].rooms.length; j++) out.push(CHAPTERS[i].rooms[j]);
    }
    return out;
  }

  function byId(id) {
    var all = allRooms();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* -------------------------------------------------------------- par ------
   * Rooms are authored with par null. Sieve's solver computes it and emits a
   * map of { roomId: {time, deaths} } in ticks, which gets stamped on here.
   *
   * It arrives as a MAP rather than being typed into this file on purpose.
   * Par changes whenever a room changes or the sim changes, and 81 numbers
   * copied by hand across that many revisions will drift, silently, into the
   * Swift medal being wrong. Generated data stays generated.
   *
   * Node (verify.cjs) can pass the parsed JSON straight in. The browser cannot
   * — fetch is blocked on file:// — so it needs the same numbers as a classic
   * script assigning BAIT.data.par, which applyPar picks up automatically.
   *
   * A missing par is survivable: the room still plays and still awards Clear,
   * Clean and Token. Only Swift is unavailable, and it says so out loud rather
   * than quietly never triggering. */
  function applyPar(map) {
    if (!map && BAIT.data && BAIT.data.par) map = BAIT.data.par;
    var all = allRooms(), missing = [], i;
    for (i = 0; i < all.length; i++) {
      var p = map && map[all[i].id];
      if (p && typeof p.time === 'number' && p.time > 0) {
        all[i].par = { time: p.time | 0, deaths: (p.deaths | 0) || 0 };
      } else {
        all[i].par = null;
        missing.push(all[i].id);
      }
    }
    return { applied: all.length - missing.length, missing: missing };
  }

  /* True only when every authored room has a par, which is what the Swift
   * medal depends on. verify.cjs should treat false as a ship blocker. */
  function parComplete() {
    var all = allRooms();
    if (!all.length) return false;
    for (var i = 0; i < all.length; i++) if (!all[i].par) return false;
    return true;
  }

  function plannedTotal() {
    var t = 0;
    for (var i = 0; i < PLANNED.length; i++) t += PLANNED[i];
    return t;
  }

  /* ------------------------------------------------------------ delegation --
   * A guest author owns their own file (src/data/ch3.js and so on), loaded
   * AFTER this one, and hands their rooms over with attach(). That keeps file
   * ownership strict — nobody else edits chapters.js — while the arc, the
   * unlock gates and the medal budget stay in one place, here.
   *
   *   BAIT.Chapters.attach(3, [ ...room objects... ]);
   *
   * A room object is exactly what R() builds:
   *   { id, name, teaches, twist, lines[14], params, par: null }
   *
   * This is deliberately strict and it THROWS rather than warning, because a
   * campaign that silently ships 61 rooms instead of 81 is the exact failure
   * nobody notices until a player runs out of game. */
  function attach(n, rooms) {
    var ch = null, i;
    for (i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].n === n) ch = CHAPTERS[i];
    if (!ch) throw new Error('attach: no chapter ' + n);
    if (ch.rooms.length) throw new Error('attach: chapter ' + n + ' already has rooms');
    if (!rooms || !rooms.length) throw new Error('attach: chapter ' + n + ' got no rooms');

    var want = PLANNED[n - 1];
    if (rooms.length !== want) {
      throw new Error('attach: chapter ' + n + ' expects ' + want +
                      ' rooms, got ' + rooms.length);
    }
    for (i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      var id = n + '-' + (i + 1 < 10 ? '0' : '') + (i + 1);
      if (r.id !== id) throw new Error('attach: room ' + i + ' of chapter ' + n +
                                       ' should have id ' + id + ', has ' + r.id);
      if (r.par !== null && r.par !== undefined) {
        throw new Error('attach: ' + r.id + ' must ship par null, the solver writes it');
      }
      if (!r.lines || r.lines.length !== 14) {
        throw new Error('attach: ' + r.id + ' must have 14 grid lines');
      }
      r.params = r.params || {};
      r.par = null;
    }
    ch.rooms = rooms;
    return ch;
  }

  /* addRooms is what the guest-author files call. It APPENDS and validates,
   * where attach() demands a whole finished chapter in one go.
   *
   * Appending rather than replacing is deliberate: a chapter file that is only
   * partly written must still boot. A half-authored chapter is a short
   * campaign, which plannedTotal() and parComplete() both catch at verify
   * time; a chapter file that THROWS at boot is a white screen and takes the
   * whole game with it. Loud at build time, survivable at run time. */
  /* Every addRooms throw lands here before it is rethrown. Forge's point is
   * correct and it is the one real cost of appending: a chapter file that
   * throws halfway registers the rooms it already got, so the chapter presents
   * as a complete short chapter and NOTHING says otherwise. The throw itself
   * scrolls past in a console nobody has open.
   *
   * The append is still right. A chapter that throws at boot is a white screen
   * and takes the other five chapters with it. So keep the append and remove
   * the silence instead: the failure is recorded here, and shortfall() turns
   * "this chapter is short" into something a screen can render. */
  var PROBLEMS = [];

  function addRooms(n, rooms) {
    var ch = null, i;
    for (i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].n === n) ch = CHAPTERS[i];
    if (!ch) throw note(n, null, 'addRooms: no chapter ' + n);
    if (!rooms || !rooms.length) throw note(n, null, 'addRooms: chapter ' + n + ' got no rooms');

    var want = PLANNED[n - 1], have = ch.rooms.length;
    if (have + rooms.length > want) {
      throw note(n, null, 'addRooms: chapter ' + n + ' would hold ' +
                          (have + rooms.length) + ' rooms, planned is ' + want);
    }
    for (i = 0; i < rooms.length; i++) {
      var r = rooms[i], seq = have + i + 1;
      var id = n + '-' + (seq < 10 ? '0' : '') + seq;
      if (r.id !== id) {
        throw note(n, r.id, 'addRooms: room ' + seq + ' of chapter ' + n +
                            ' should have id ' + id + ', has ' + r.id);
      }
      if (!r.lines || r.lines.length !== 14) {
        throw note(n, r.id, 'addRooms: ' + r.id + ' must have 14 grid lines');
      }
      if (r.par !== null && r.par !== undefined) {
        throw note(n, r.id, 'addRooms: ' + r.id + ' must ship par null, the solver writes it');
      }
      r.params = r.params || {};
      r.par = null;
      ch.rooms.push(r);
    }
    return ch;
  }

  /* Record, shout, and hand back the Error for the caller to throw. */
  function note(n, id, message) {
    PROBLEMS.push({ chapter: n, at: id || null, message: message });
    if (typeof console !== 'undefined' && console.warn) console.warn('BAIT campaign: ' + message);
    return new Error(message);
  }

  /* Which chapters hold fewer rooms than the plan says, and by how many.
   * Empty array means the campaign is whole. Frame can render this on chapter
   * select and Sieve can fail a build on it; either way it stops being a
   * console line nobody reads. */
  function shortfall() {
    var out = [];
    for (var i = 0; i < CHAPTERS.length; i++) {
      var ch = CHAPTERS[i], want = PLANNED[ch.n - 1], have = ch.rooms.length;
      if (have !== want) out.push({ n: ch.n, title: ch.title, have: have, want: want });
    }
    return out;
  }

  BAIT.Chapters = {
    VERSION: 1,
    list: CHAPTERS,
    PLANNED: PLANNED,
    plannedTotal: plannedTotal,
    allRooms: allRooms,
    byId: byId,
    attach: attach,
    addRooms: addRooms,
    problems: PROBLEMS,
    shortfall: shortfall,
    applyPar: applyPar,
    parComplete: parComplete,
    R: R,
    MEDALS_PER_ROOM: 4
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BAIT.Chapters;

})(typeof window !== 'undefined'
  ? (window.BAIT = window.BAIT || {})
  : (global.BAIT = global.BAIT || {}));
