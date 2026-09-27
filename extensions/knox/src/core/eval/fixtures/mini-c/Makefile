CC ?= gcc
CFLAGS ?= -Wall -Werror

all: add_test

add.o: add.c add.h
	$(CC) $(CFLAGS) -c add.c -o add.o

add_test: add.o main.c
	$(CC) $(CFLAGS) add.o main.c -o add_test

test: add_test
	./add_test

clean:
	rm -f add.o add_test
