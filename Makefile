all: 

.PHONY: roster
roster: 
	railway volume files upload ./data/roster-real.csv /roster.csv --overwrite
